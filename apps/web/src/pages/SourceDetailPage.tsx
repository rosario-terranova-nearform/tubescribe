import { useSourceJobs } from '@/api/jobs.ts';
import { hasActiveJobs, useInvalidateOnIdle } from '@/api/query-client.ts';
import {
  sourceQueryKey,
  useDeleteSource,
  useReextractSource,
  useReindexSource,
  useSource,
  useSourceVideos,
} from '@/api/sources.ts';
import { VideoStatusBadge } from '@/components/VideoStatusBadge.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { formatDuration } from '@/lib/format.ts';
import type { SourceTypeFilter } from '@tubescribe/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

const VIDEOS_PAGE_SIZE = 500;

function TypeFilterBadges({ typeFilter }: { typeFilter: SourceTypeFilter }) {
  const enabled = (['uploads', 'shorts', 'live'] as const).filter((key) => typeFilter[key]);
  return (
    <>
      {enabled.map((key) => (
        <Badge key={key} variant="outline">
          {key}
        </Badge>
      ))}
    </>
  );
}

export function SourceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Source-scoped jobs drive everything: poll while one is active, refresh
  // once when the last job finishes (see useInvalidateOnIdle).
  const jobsQuery = useSourceJobs(id);
  const active = hasActiveJobs(jobsQuery.data);
  const sourceQuery = useSource(id, { poll: active });
  const [limit, setLimit] = useState(VIDEOS_PAGE_SIZE);
  const videosQuery = useSourceVideos(id, limit, { poll: active });
  useInvalidateOnIdle(active, sourceQueryKey(id));

  const [reindexOpen, setReindexOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const reextract = useReextractSource(id);
  const reindex = useReindexSource(id);
  const deleteSource = useDeleteSource(id);

  if (sourceQuery.isPending) {
    return (
      <section className="flex flex-col gap-6" aria-busy="true">
        <div className="flex items-start gap-4">
          <Skeleton className="size-20 rounded-md" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-40 w-full" />
      </section>
    );
  }

  if (sourceQuery.isError) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Source</h1>
        <p role="alert" className="text-sm text-destructive">
          Could not load source {id}: {sourceQuery.error.message}
        </p>
        <p>
          <Link to="/sources" className="text-sm font-medium underline">
            Back to sources
          </Link>
        </p>
      </section>
    );
  }

  const source = sourceQuery.data.source;
  const activeJob = jobsQuery.data?.jobs.find(
    (job) => job.status === 'queued' || job.status === 'running',
  );
  const jobDone = (activeJob?.processedItems ?? 0) + (activeJob?.failedItems ?? 0);
  const jobPercent =
    activeJob && activeJob.totalItems > 0 ? Math.round((jobDone / activeJob.totalItems) * 100) : 0;

  const videos = videosQuery.data?.videos ?? [];
  const videosTotal = videosQuery.data?.total ?? source.status.total;

  const onReextract = () =>
    reextract.mutate(undefined, {
      onSuccess: (data) =>
        toast.success(
          `Re-extraction started for ${data.job.totalItems} video${data.job.totalItems === 1 ? '' : 's'}`,
        ),
      onError: (err) => toast.error(err.message),
    });

  const onReindex = () =>
    reindex.mutate(undefined, {
      onSuccess: () => {
        setReindexOpen(false);
        toast.success('Reindex started');
      },
      onError: (err) => toast.error(err.message),
    });

  const onDelete = () =>
    deleteSource.mutate(undefined, {
      onSuccess: () => {
        setDeleteOpen(false);
        toast.success('Source deleted');
        navigate('/sources');
      },
      onError: (err) => toast.error(err.message),
    });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          {source.thumbnailUrl && (
            <img
              src={source.thumbnailUrl}
              alt=""
              className="size-20 shrink-0 rounded-md bg-muted object-cover"
            />
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{source.title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{source.kind}</Badge>
              <code className="text-xs">{source.identifier}</code>
              <TypeFilterBadges typeFilter={source.typeFilter} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={active || reextract.isPending || source.status.failed === 0}
            title={
              source.status.failed === 0 ? 'No failed videos' : 'Re-extract failed videos only'
            }
            onClick={onReextract}
          >
            Re-extract failed ({source.status.failed})
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={active || reindex.isPending}
            onClick={() => setReindexOpen(true)}
          >
            Reindex
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteSource.isPending}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {activeJob && (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span>
                {activeJob.kind === 'extract' ? 'Extracting transcripts' : 'Embedding chunks'} (
                {activeJob.status})
              </span>
              <span className="text-muted-foreground">
                {jobDone}/{activeJob.totalItems}
                {activeJob.failedItems > 0 && ` · ${activeJob.failedItems} failed`}
              </span>
            </div>
            <Progress value={jobPercent} aria-label="Extraction progress" />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Videos ({videosTotal})</h2>
        {videosQuery.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load videos: {videosQuery.error.message}
          </p>
        )}
        {!videosQuery.isError && videos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No videos{active ? ' yet — extraction is still discovering them' : ''}.
          </p>
        )}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <li key={video.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <img
                src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                alt=""
                loading="lazy"
                className="aspect-video w-full rounded-md bg-muted object-cover"
              />
              <a
                href={video.url}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-2 text-sm font-medium hover:underline"
              >
                {video.title}
              </a>
              <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{formatDuration(video.durationS)}</span>
                <VideoStatusBadge status={video.status} error={video.error} />
              </div>
            </li>
          ))}
        </ul>
        {videos.length < videosTotal && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLimit((n) => n + VIDEOS_PAGE_SIZE)}
            >
              Show more ({videos.length} of {videosTotal})
            </Button>
          </div>
        )}
      </div>

      <Dialog open={reindexOpen} onOpenChange={setReindexOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reindex embeddings?</DialogTitle>
            <DialogDescription>
              Rebuilds this source's embedding chunks with the current embedding model. Note: if the
              embedding model changed since the last index, the first reindex resets embeddings for
              all sources.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReindexOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onReindex} disabled={reindex.isPending}>
              {reindex.isPending ? 'Starting…' : 'Reindex'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete source?</DialogTitle>
            <DialogDescription>
              Permanently deletes "{source.title}", its videos, transcripts, chunks and embeddings.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={deleteSource.isPending}>
              {deleteSource.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
