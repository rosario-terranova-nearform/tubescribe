// Sources REST API (task 06): resolve → confirm → create (auto-starts an
// extraction job), list with aggregated status, detail, paginated videos,
// re-extract, and delete. All request/response bodies are validated with the
// @tubescribe/shared schemas; YouTube access goes through the injected
// InnertubeFactory so tests fake the boundary, never the network.

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  CreateSourceRequestSchema,
  CreateSourceResponseSchema,
  DEFAULT_TYPE_FILTER,
  DeleteSourceResponseSchema,
  GetSourceResponseSchema,
  ListSourceVideosQuerySchema,
  ListSourceVideosResponseSchema,
  ListSourcesResponseSchema,
  ReextractSourceQuerySchema,
  ReextractSourceResponseSchema,
  ResolveSourceRequestSchema,
  ResolveSourceResponseSchema,
  type SourceInput,
  SourceInputError,
  type SourceStatusCounts,
  type SourceTypeFilter,
  parseSourceInput,
} from '@tubescribe/shared';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Express, NextFunction, Request, Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { sources, videos } from '../db/schema.js';
import { HttpError } from '../http-error.js';
import { createJob } from '../jobs/queue.js';
import { getSourceStatus } from '../jobs/status.js';
import { listSourceVideos } from '../youtube/list.js';
import { resolveSource } from '../youtube/resolve.js';
import type {
  DiscoveredVideo,
  InnertubeFactory,
  InnertubeLike,
  ResolvedSource,
} from '../youtube/types.js';

export interface SourcesRoutesDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  /** Lazily creates the youtube client — creation may do I/O. */
  youtube: InnertubeFactory;
  /** Wakes the extraction worker after a job is enqueued. */
  worker?: { notify(): void };
}

/** Express 4 does not forward async rejections to the error middleware. */
function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

/** Cache the created client; a failed creation is retried on the next call. */
function memoize(factory: InnertubeFactory): () => Promise<InnertubeLike> {
  let cached: Promise<InnertubeLike> | null = null;
  return () => {
    if (!cached) {
      cached = factory();
      cached.catch(() => {
        cached = null;
      });
    }
    return cached;
  };
}

/** A duplicate is the same normalized (kind, identifier), regardless of input spelling. */
function findDuplicate(db: Db, kind: SourceInput['kind'], identifier: string) {
  return db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, kind), eq(sources.identifier, identifier)))
    .get();
}

function statusCounts(db: Db, sourceId: string): SourceStatusCounts {
  const s = getSourceStatus(db, sourceId);
  return {
    total: s.total,
    pending: s.pending,
    fetched: s.fetched,
    failed: s.failed,
    embedded: s.embedded,
  };
}

function getSourceOr404(db: Db, id: string) {
  const source = db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) throw new HttpError(404, 'NOT_FOUND', `source not found: ${id}`);
  return source;
}

/** Parser failures are client input problems: 400 VALIDATION with the reason. */
function parseInputOrThrow(raw: string): SourceInput {
  try {
    return parseSourceInput(raw);
  } catch (err) {
    if (err instanceof SourceInputError) {
      throw new HttpError(400, 'VALIDATION', 'unrecognizable source input', {
        field: 'input',
        reason: err.message,
      });
    }
    throw err;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** YouTube resolution failures (unknown id, network, bot check) → 422. */
async function resolveOr422(
  getClient: () => Promise<InnertubeLike>,
  input: SourceInput,
): Promise<ResolvedSource> {
  try {
    return await resolveSource(await getClient(), input);
  } catch (err) {
    throw new HttpError(422, 'UNPROCESSABLE', `could not resolve ${input.kind}`, {
      field: 'identifier',
      reason: describe(err),
    });
  }
}

/** Listing happens before the source row is inserted, so a failure persists nothing. */
async function listOr422(
  getClient: () => Promise<InnertubeLike>,
  resolved: ResolvedSource,
  typeFilter: SourceTypeFilter,
): Promise<DiscoveredVideo[]> {
  try {
    const discovered: DiscoveredVideo[] = [];
    for await (const video of listSourceVideos(await getClient(), resolved, typeFilter)) {
      discovered.push(video);
    }
    return discovered;
  } catch (err) {
    throw new HttpError(422, 'UNPROCESSABLE', `could not list videos for ${resolved.identifier}`, {
      reason: describe(err),
    });
  }
}

export function registerSourcesRoutes(app: Express, deps: SourcesRoutesDeps): void {
  const { db, config, worker } = deps;
  const getClient = memoize(deps.youtube);

  app.post(
    '/api/sources/resolve',
    ah(async (req, res) => {
      const { input } = ResolveSourceRequestSchema.parse(req.body ?? {});
      const parsed = parseInputOrThrow(input);
      const resolved = await resolveOr422(getClient, parsed);
      const duplicate = findDuplicate(db, resolved.kind, resolved.identifier) !== undefined;
      res.json(
        ResolveSourceResponseSchema.parse({
          suggestion: {
            kind: resolved.kind,
            identifier: resolved.identifier,
            title: resolved.title,
            thumbnailUrl: resolved.thumbnailUrl,
            channelTitle: null,
            videoCount: resolved.videoCount ?? null,
            duplicate,
          },
        }),
      );
    }),
  );

  app.post(
    '/api/sources',
    ah(async (req, res) => {
      const body = CreateSourceRequestSchema.parse(req.body ?? {});
      const typeFilter = body.typeFilter ?? DEFAULT_TYPE_FILTER;
      const resolved = await resolveOr422(getClient, {
        kind: body.kind,
        identifier: body.identifier,
      });
      if (findDuplicate(db, resolved.kind, resolved.identifier)) {
        throw new HttpError(409, 'CONFLICT', `source already exists: ${resolved.identifier}`, {
          field: 'identifier',
          reason: 'a source with this normalized identifier already exists',
        });
      }
      const discovered = await listOr422(getClient, resolved, typeFilter);

      const source = {
        id: randomUUID(),
        kind: resolved.kind,
        identifier: resolved.identifier,
        title: resolved.title,
        thumbnailUrl: resolved.thumbnailUrl,
        channelId: null,
        channelTitle: null,
        videoCount: resolved.videoCount ?? null,
        typeFilter,
        createdAt: new Date().toISOString(),
      } satisfies typeof sources.$inferInsert;
      db.insert(sources).values(source).run();
      const job = createJob(db, { kind: 'extract', sourceId: source.id, videos: discovered });
      worker?.notify();
      res.status(201).json(CreateSourceResponseSchema.parse({ source, job }));
    }),
  );

  app.get('/api/sources', (_req, res) => {
    const rows = db.select().from(sources).orderBy(desc(sources.createdAt)).all();
    res.json(
      ListSourcesResponseSchema.parse({
        sources: rows.map((row) => ({ ...row, status: statusCounts(db, row.id) })),
      }),
    );
  });

  app.get('/api/sources/:id', (req, res) => {
    const source = getSourceOr404(db, req.params.id);
    res.json(
      GetSourceResponseSchema.parse({
        source: { ...source, status: statusCounts(db, source.id) },
      }),
    );
  });

  app.get('/api/sources/:id/videos', (req, res) => {
    const { limit, offset } = ListSourceVideosQuerySchema.parse(req.query);
    const source = getSourceOr404(db, req.params.id);
    const rows = db
      .select()
      .from(videos)
      .where(eq(videos.sourceId, source.id))
      .orderBy(asc(sql`${videos}.rowid`))
      .limit(limit)
      .offset(offset)
      .all();
    const total =
      db.select({ n: count() }).from(videos).where(eq(videos.sourceId, source.id)).get()?.n ?? 0;
    res.json(ListSourceVideosResponseSchema.parse({ videos: rows, total, limit, offset }));
  });

  app.post('/api/sources/:id/reextract', (req, res) => {
    const { all } = ReextractSourceQuerySchema.parse(req.query);
    const source = getSourceOr404(db, req.params.id);
    const targets = db
      .select()
      .from(videos)
      .where(
        and(
          eq(videos.sourceId, source.id),
          all === 'true' ? undefined : eq(videos.status, 'failed'),
        ),
      )
      .all();
    const job = createJob(db, {
      kind: 'extract',
      sourceId: source.id,
      videos: targets.map((v): DiscoveredVideo => {
        return {
          videoId: v.id,
          title: v.title,
          publishedAt: v.publishedAt,
          durationS: v.durationS,
        };
      }),
    });
    if (targets.length > 0) {
      db.update(videos)
        .set({ status: 'pending', error: null })
        .where(
          inArray(
            videos.id,
            targets.map((v) => v.id),
          ),
        )
        .run();
    }
    worker?.notify();
    res.status(201).json(ReextractSourceResponseSchema.parse({ job }));
  });

  app.delete('/api/sources/:id', (req, res) => {
    const source = getSourceOr404(db, req.params.id);
    // FK cascades remove videos, jobs, job_items and bot_sources rows.
    db.delete(sources).where(eq(sources.id, source.id)).run();
    rmSync(join(config.dataDir, 'transcripts', source.id), { recursive: true, force: true });
    res.json(DeleteSourceResponseSchema.parse({ ok: true }));
  });
}
