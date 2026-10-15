import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import type { SourceWithStatus } from '@tubescribe/shared';
import { Link } from 'react-router';

/** One source in the /sources list: thumbnail, title, kind and counts by status. */
export function SourceCard({ source }: { source: SourceWithStatus }) {
  const { status } = source;
  return (
    <Link to={`/sources/${source.id}`} className="block rounded-xl focus-visible:outline-none">
      <Card className="flex-row items-center gap-4 p-4 transition-colors hover:bg-accent/40">
        {source.thumbnailUrl && (
          <img
            src={source.thumbnailUrl}
            alt=""
            className="size-16 shrink-0 rounded-md bg-muted object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{source.title}</span>
            <Badge variant="secondary">{source.kind}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{status.total} videos</span>
            {status.pending > 0 && <span>{status.pending} pending</span>}
            {status.fetched > 0 && <span>{status.fetched} fetched</span>}
            {status.embedded > 0 && <span>{status.embedded} embedded</span>}
            {status.failed > 0 && (
              <span className="font-medium text-destructive">{status.failed} failed</span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
