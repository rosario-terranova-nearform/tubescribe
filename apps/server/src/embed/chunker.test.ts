import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TOKENS,
  type ChunkerSegment,
  chunkTranscript,
} from './chunker.js';

const META = { videoId: 'vid00000001', sourceId: 'source-test', title: 'Test video' };

/** Deterministic tokenizer: one whitespace-separated word = one token. */
const wordCount = (text: string) => text.split(' ').filter(Boolean);

/** Segments of `wordCount` words each, 1s apart: 'w0 w0 ...', 'w1 w1 ...'. */
function segments(count: number, wordsEach: number): ChunkerSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    text: Array.from({ length: wordsEach }, () => `w${i}`).join(' '),
    startMs: i * 1000,
    endMs: i * 1000 + 900,
  }));
}

describe('chunkTranscript', () => {
  it('empty transcript yields no chunks', () => {
    expect(chunkTranscript({ ...META, segments: [] })).toEqual([]);
    expect(
      chunkTranscript({ ...META, segments: [{ text: '   ', startMs: 0, endMs: 500 }] }),
    ).toEqual([]);
  });

  it('short transcript (under maxTokens) yields a single chunk', () => {
    const chunks = chunkTranscript(
      { ...META, segments: segments(3, 4) },
      { maxTokens: 500, overlapTokens: 50, encode: wordCount },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 2900 });
    expect(chunks[0]?.text).toBe('w0 w0 w0 w0 w1 w1 w1 w1 w2 w2 w2 w2');
  });

  it('carries citation metadata on every chunk', () => {
    const chunks = chunkTranscript(
      { ...META, segments: segments(4, 10) },
      { maxTokens: 25, overlapTokens: 5, encode: wordCount },
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.videoId).toBe(META.videoId);
      expect(chunk.sourceId).toBe(META.sourceId);
      expect(chunk.title).toBe(META.title);
      expect(Number.isInteger(chunk.startMs)).toBe(true);
      expect(Number.isInteger(chunk.endMs)).toBe(true);
      expect(chunk.endMs).toBeGreaterThanOrEqual(chunk.startMs);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('packs segments up to maxTokens and never splits a segment', () => {
    // 10-word segments, maxTokens 25 → 2 segments per chunk (3 would exceed).
    const segs = segments(5, 10);
    const chunks = chunkTranscript(
      { ...META, segments: segs },
      { maxTokens: 25, overlapTokens: 0, encode: wordCount },
    );
    expect(chunks).toHaveLength(3);
    // Every chunk boundary is a segment boundary: chunk i covers segments [2i, 2i+1].
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 1900 });
    expect(chunks[1]).toMatchObject({ startMs: 2000, endMs: 3900 });
    expect(chunks[2]).toMatchObject({ startMs: 4000, endMs: 4900 });
    for (const chunk of chunks) {
      for (const word of chunk.text.split(' ')) {
        expect(segs.some((s) => s.text.includes(word))).toBe(true);
      }
    }
  });

  it('overlaps consecutive chunks by ~overlapTokens worth of whole segments', () => {
    // 10-word segments, maxTokens 40 (4 segs), overlap 20 (2 segs).
    const chunks = chunkTranscript(
      { ...META, segments: segments(8, 10) },
      { maxTokens: 40, overlapTokens: 20, encode: wordCount },
    );
    // Windows: [0..3], [2..5], [4..7] → 3 chunks.
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 3900 });
    expect(chunks[1]).toMatchObject({ startMs: 2000, endMs: 5900 });
    expect(chunks[2]).toMatchObject({ startMs: 4000, endMs: 7900 });
    // The overlap is the shared tail/head: chunk1 starts where chunk0's last two segments start.
    const [chunk0, chunk1] = chunks;
    expect(
      chunk0 && chunk1 && chunk1.text.startsWith(chunk0.text.split(' ').slice(-20).join(' ')),
    ).toBe(true);
  });

  it('a segment larger than maxTokens becomes its own chunk (no infinite loop)', () => {
    const segs: ChunkerSegment[] = [
      { text: Array.from({ length: 60 }, () => 'big').join(' '), startMs: 0, endMs: 5000 },
      { text: 'small words', startMs: 5000, endMs: 6000 },
      { text: 'more words', startMs: 6000, endMs: 7000 },
    ];
    const chunks = chunkTranscript(
      { ...META, segments: segs },
      { maxTokens: 10, overlapTokens: 5, encode: wordCount },
    );
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 5000 });
    // The tail chunk continues after the giant segment.
    expect(chunks.at(-1)?.endMs).toBe(7000);
  });

  it('clamps overlap so the window always advances (tiny chunks of tiny segments)', () => {
    // maxTokens 3, overlap 2, 1-word segments → chunks of 3 segs with 2-seg overlap.
    const chunks = chunkTranscript(
      { ...META, segments: segments(5, 1) },
      { maxTokens: 3, overlapTokens: 2, encode: wordCount },
    );
    // Windows: [0..2], [1..3], [2..4] — 2-segment overlap, always advancing.
    expect(chunks.map((c) => c.startMs)).toEqual([0, 1000, 2000]);
    expect(chunks[chunks.length - 1]).toMatchObject({ startMs: 2000, endMs: 4900 });
  });

  it('works with the real gpt-tokenizer on natural text', async () => {
    const sentence =
      'The quick brown fox jumps over the lazy dog while the cat watches from the windowsill.';
    const segs: ChunkerSegment[] = Array.from({ length: 120 }, (_, i) => ({
      text: sentence,
      startMs: i * 5000,
      endMs: i * 5000 + 4500,
    }));
    const chunks = chunkTranscript({ ...META, segments: segs });
    expect(chunks.length).toBeGreaterThan(1);
    // ~500-token target: the full chunks land in a sane band around it.
    const { encode } = await import('gpt-tokenizer');
    for (const chunk of chunks.slice(0, -1)) {
      expect(encode(chunk.text).length).toBeGreaterThanOrEqual(400);
      expect(encode(chunk.text).length).toBeLessThanOrEqual(600);
    }
    // Boundaries stay on segments.
    expect((chunks[0]?.startMs ?? -1) % 5000).toBe(0);
    expect((chunks[0]?.endMs ?? -1) % 5000).toBe(4500);
  });

  it('defaults to 500 tokens / 50 overlap constants from the design', () => {
    expect(CHUNK_TOKENS).toBe(500);
    expect(CHUNK_OVERLAP_TOKENS).toBe(50);
  });
});
