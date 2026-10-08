import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptFileSchema, transcriptPaths, writeTranscriptFiles } from './files.js';
import type { TranscriptFile } from './files.js';

// Spy on the fs primitives (wrapping the real implementations) so the atomic
// write-temp-then-rename dance is directly observable.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    renameSync: vi.fn(actual.renameSync),
  };
});

const SAMPLE: TranscriptFile = {
  videoId: 'abc123def45',
  sourceId: 'source-1',
  title: 'Test video',
  url: 'https://www.youtube.com/watch?v=abc123def45',
  publishedAt: '2023-03-05T00:00:00.000Z',
  durationS: 754,
  language: 'en',
  captionKind: 'manual',
  engine: 'youtubei.js',
  fetchedAt: '2026-10-08T10:00:00.000Z',
  segments: [
    { text: 'hello world', startMs: 1200, endMs: 3400 },
    { text: 'second line', startMs: 3400, endMs: 5900 },
  ],
  fullText: 'hello world\nsecond line',
};

describe('writeTranscriptFiles', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tubescribe-files-test-'));
    vi.mocked(writeFileSync).mockClear();
    vi.mocked(renameSync).mockClear();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes <DATA_DIR>/transcripts/<sourceId>/<videoId>.json with the DESIGN.md shape', () => {
    const { jsonPath } = writeTranscriptFiles(dataDir, SAMPLE);

    expect(jsonPath).toBe(join(dataDir, 'transcripts', 'source-1', 'abc123def45.json'));
    const parsed: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // Exact shape, no more, no less…
    expect(parsed).toEqual(SAMPLE);
    // …and it satisfies the schema.
    expect(TranscriptFileSchema.parse(parsed)).toEqual(SAMPLE);
  });

  it('writes a companion .md with title, metadata, and full text', () => {
    const { mdPath } = writeTranscriptFiles(dataDir, SAMPLE);

    expect(mdPath).toBe(join(dataDir, 'transcripts', 'source-1', 'abc123def45.md'));
    const md = readFileSync(mdPath, 'utf8');
    expect(md).toContain('# Test video');
    expect(md).toContain('- URL: https://www.youtube.com/watch?v=abc123def45');
    expect(md).toContain('- Language: en');
    expect(md).toContain('hello world\nsecond line');
  });

  it('writes atomically: temp file first, then rename to the final path', () => {
    writeTranscriptFiles(dataDir, SAMPLE);
    const { jsonPath, mdPath } = transcriptPaths(dataDir, SAMPLE.sourceId, SAMPLE.videoId);

    const writes = vi.mocked(writeFileSync).mock.calls.map(([path]) => String(path));
    const renames = vi
      .mocked(renameSync)
      .mock.calls.map(([from, to]) => ({ from: String(from), to: String(to) }));

    // Nothing is ever written directly to a final transcript path.
    expect(writes).toHaveLength(2);
    for (const path of writes) expect(path).toMatch(/\.tmp$/);
    expect(writes).not.toContain(jsonPath);
    expect(writes).not.toContain(mdPath);

    // Each final path is produced by renaming its temp file.
    expect(renames).toHaveLength(2);
    for (const { from } of renames) {
      expect(from).toMatch(/\.tmp$/);
      expect(writes).toContain(from);
    }
    expect(renames.map((r) => r.to).sort()).toEqual([jsonPath, mdPath].sort());

    // No temp files are left behind.
    const dir = join(dataDir, 'transcripts', SAMPLE.sourceId);
    expect(readdirSync(dir).sort()).toEqual(['abc123def45.json', 'abc123def45.md']);
  });

  it('creates the source directory recursively and overwrites existing files', () => {
    writeTranscriptFiles(dataDir, SAMPLE);
    const again = { ...SAMPLE, title: 'Re-fetched title', fullText: 'new text' };
    writeTranscriptFiles(dataDir, again);

    const { jsonPath, mdPath } = transcriptPaths(dataDir, SAMPLE.sourceId, SAMPLE.videoId);
    expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toEqual(again);
    expect(readFileSync(mdPath, 'utf8')).toContain('# Re-fetched title');
  });

  it('handles null publishedAt / captionKind', () => {
    const nullable: TranscriptFile = { ...SAMPLE, publishedAt: null, captionKind: null };
    const { jsonPath, mdPath } = writeTranscriptFiles(dataDir, nullable);

    expect(existsSync(jsonPath)).toBe(true);
    expect(TranscriptFileSchema.parse(JSON.parse(readFileSync(jsonPath, 'utf8')))).toEqual(
      nullable,
    );
    expect(readFileSync(mdPath, 'utf8')).toContain('- Published: unknown');
  });
});
