// Transcript file writer: <DATA_DIR>/transcripts/<sourceId>/<videoId>.json and
// .md (docs/DESIGN.md). Writes are atomic — write a temp file in the same
// directory, then rename — so a crash mid-write never leaves a truncated
// transcript behind.

import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaptionKindSchema, EngineSchema } from '@tubescribe/shared';
import { z } from 'zod';

/** On-disk JSON transcript shape (docs/DESIGN.md, "JSON content"). */
export const TranscriptFileSchema = z.object({
  videoId: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  durationS: z.number().nonnegative(),
  language: z.string(),
  captionKind: CaptionKindSchema.nullable(),
  engine: EngineSchema,
  fetchedAt: z.string(),
  segments: z.array(
    z.object({ text: z.string(), startMs: z.number().int(), endMs: z.number().int() }),
  ),
  fullText: z.string(),
});
export type TranscriptFile = z.infer<typeof TranscriptFileSchema>;

export function transcriptPaths(
  dataDir: string,
  sourceId: string,
  videoId: string,
): { jsonPath: string; mdPath: string } {
  const dir = join(dataDir, 'transcripts', sourceId);
  return { jsonPath: join(dir, `${videoId}.json`), mdPath: join(dir, `${videoId}.md`) };
}

/** Write the .json + .md pair atomically, creating the source dir as needed. */
export function writeTranscriptFiles(
  dataDir: string,
  transcript: TranscriptFile,
): { jsonPath: string; mdPath: string } {
  const { jsonPath, mdPath } = transcriptPaths(dataDir, transcript.sourceId, transcript.videoId);
  mkdirSync(join(dataDir, 'transcripts', transcript.sourceId), { recursive: true });
  writeFileAtomic(jsonPath, `${JSON.stringify(transcript, null, 2)}\n`);
  writeFileAtomic(mdPath, renderTranscriptMarkdown(transcript));
  return { jsonPath, mdPath };
}

function writeFileAtomic(path: string, content: string): void {
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, path);
}

function renderTranscriptMarkdown(t: TranscriptFile): string {
  return [
    `# ${t.title}`,
    '',
    `- URL: ${t.url}`,
    `- Video: ${t.videoId}`,
    `- Source: ${t.sourceId}`,
    `- Published: ${t.publishedAt ?? 'unknown'}`,
    `- Duration: ${t.durationS}s`,
    `- Language: ${t.language}`,
    `- Captions: ${t.captionKind ?? 'unknown'}`,
    `- Engine: ${t.engine}`,
    `- Fetched: ${t.fetchedAt}`,
    '',
    '---',
    '',
    t.fullText,
    '',
  ].join('\n');
}
