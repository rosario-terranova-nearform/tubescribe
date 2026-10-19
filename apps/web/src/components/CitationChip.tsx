import { formatDuration } from '@/lib/format.ts';
import type { Citation } from '@tubescribe/shared';

/**
 * One citation: `[n] <title> @ mm:ss`, linking to the video at the cited
 * timestamp (`t=<seconds>s`) in a new tab. `index` is 0-based; the rendered
 * number matches the 1-based [n] markers in the assistant's answer.
 */
export function CitationChip({ citation, index }: { citation: Citation; index: number }) {
  const seconds = Math.floor(citation.startMs / 1000);
  const href = `https://youtube.com/watch?v=${encodeURIComponent(citation.videoId)}&t=${seconds}s`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <span className="font-medium text-foreground">[{index + 1}]</span>
      <span className="truncate">{citation.title}</span>
      <span className="shrink-0 tabular-nums">@ {formatDuration(seconds)}</span>
    </a>
  );
}
