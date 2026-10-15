import { Badge } from '@/components/ui/badge.tsx';
import type { VideoStatus } from '@tubescribe/shared';

const STATUS_VARIANTS = {
  pending: 'outline',
  fetched: 'secondary',
  failed: 'destructive',
  embedded: 'default',
} as const;

/**
 * Per-video status badge. Failed badges carry the extraction error message as
 * a native tooltip (and aria-label) so hovering reveals why the video failed.
 */
export function VideoStatusBadge({
  status,
  error,
}: {
  status: VideoStatus;
  error?: string | null;
}) {
  if (status === 'failed') {
    const reason = error ?? 'extraction failed';
    return (
      <Badge variant="destructive" title={reason} aria-label={`failed: ${reason}`}>
        failed
      </Badge>
    );
  }
  return <Badge variant={STATUS_VARIANTS[status]}>{status}</Badge>;
}
