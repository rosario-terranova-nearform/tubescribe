// Transcript chunker: ~500-token chunks with ~10% overlap, aligned to
// transcript segment boundaries — a chunk is always a run of whole segments,
// so its [startMs, endMs] citation range never cuts mid-timestamp
// (docs/DESIGN.md "LLM and retrieval").
//
// The default tokenizer is gpt-tokenizer (pure JS); tests inject cheaper
// counters (e.g. word count) for deterministic sizes.

import { encode as gptEncode } from 'gpt-tokenizer';

/** Target chunk size in tokens. */
export const CHUNK_TOKENS = 500;
/** Target overlap between consecutive chunks, in tokens (10%). */
export const CHUNK_OVERLAP_TOKENS = 50;

export interface ChunkerSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ChunkerInput {
  videoId: string;
  sourceId: string;
  title: string;
  segments: ChunkerSegment[];
}

/** A chunk carries everything a citation chip needs (videoId → youtube t= link). */
export interface TranscriptChunk {
  videoId: string;
  sourceId: string;
  title: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface ChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
  /** Token counter; defaults to gpt-tokenizer's cl100k/o200k encode. */
  encode?: (text: string) => unknown[];
}

/**
 * Sliding window over whole segments: grow a chunk until the next segment
 * would exceed `maxTokens`, then restart the next window ~`overlapTokens`
 * back from the tail. A single segment larger than `maxTokens` becomes its
 * own chunk (segments are never split). Empty/whitespace segments are
 * dropped; an empty transcript yields no chunks.
 */
export function chunkTranscript(
  input: ChunkerInput,
  options: ChunkerOptions = {},
): TranscriptChunk[] {
  const maxTokens = options.maxTokens ?? CHUNK_TOKENS;
  const overlapTokens = options.overlapTokens ?? CHUNK_OVERLAP_TOKENS;
  const encode = options.encode ?? gptEncode;

  const segments = input.segments.filter((s) => s.text.trim().length > 0);
  if (segments.length === 0) return [];
  const tokenCounts = segments.map((s) => encode(s.text.trim()).length);

  const chunks: TranscriptChunk[] = [];
  let start = 0;
  while (start < segments.length) {
    // Grow the window [start, end) up to maxTokens (always ≥ 1 segment).
    let end = start;
    let tokens = 0;
    while (end < segments.length) {
      const count = tokenCounts[end] ?? 0;
      if (tokens + count > maxTokens && end > start) break;
      tokens += count;
      end += 1;
    }

    const windowSegments = segments.slice(start, end);
    const first = windowSegments[0];
    const last = windowSegments[windowSegments.length - 1];
    if (!first || !last) break; // unreachable: end > start
    chunks.push({
      videoId: input.videoId,
      sourceId: input.sourceId,
      title: input.title,
      startMs: first.startMs,
      endMs: last.endMs,
      text: windowSegments.map((s) => s.text.trim()).join(' '),
    });

    if (end === segments.length) break;

    // Overlap: restart the next window ~overlapTokens back from the tail,
    // but always at least one segment forward so the window makes progress
    // (matters when one segment alone exceeds overlapTokens).
    let overlap = 0;
    let nextStart = end;
    while (nextStart > start && overlap < overlapTokens) {
      nextStart -= 1;
      overlap += tokenCounts[nextStart] ?? 0;
    }
    start = Math.max(nextStart, start + 1);
  }
  return chunks;
}
