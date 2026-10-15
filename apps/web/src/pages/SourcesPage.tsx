import { useJobs } from '@/api/jobs.ts';
import { hasActiveJobs, useInvalidateOnIdle } from '@/api/query-client.ts';
import { sourcesQueryKey, useSources } from '@/api/sources.ts';
import { AddSourceBox } from '@/components/AddSourceBox.tsx';
import { SourceCard } from '@/components/SourceCard.tsx';

export function SourcesPage() {
  // Reuse the header's global jobs query (shared cache): while any job runs,
  // poll the list so status counts stay fresh; refresh once more when idle.
  const jobsQuery = useJobs();
  const active = hasActiveJobs(jobsQuery.data);
  const sourcesQuery = useSources({ poll: active });
  useInvalidateOnIdle(active, sourcesQueryKey);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
      <AddSourceBox />
      {sourcesQuery.isPending && <p className="text-sm text-muted-foreground">Loading sources…</p>}
      {sourcesQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load sources: {sourcesQuery.error.message}
        </p>
      )}
      {sourcesQuery.data?.sources.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No sources yet — paste a channel, playlist, or video above to start your corpus.
        </p>
      )}
      <div className="grid gap-3">
        {sourcesQuery.data?.sources.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
    </section>
  );
}
