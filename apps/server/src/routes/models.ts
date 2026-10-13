// OpenRouter model catalog proxy (task 08): GET /api/models serves the
// public model list, cached 1h in memory; ?type=embedding switches to the
// embeddings catalog. The upstream endpoints are public — no Authorization
// header is ever sent, so the server-only API key cannot leak into the
// request, and the mapped response contains no key material either.

import { ListModelsQuerySchema, ListModelsResponseSchema, type Model } from '@tubescribe/shared';
import type { Express, NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { HttpError } from '../http-error.js';

const UPSTREAM_URLS = {
  chat: 'https://openrouter.ai/api/v1/models',
  embedding: 'https://openrouter.ai/api/v1/embeddings/models',
} as const;

type CatalogType = keyof typeof UPSTREAM_URLS;

/** In-memory catalog cache lifetime (1 h). */
export const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;

/** The slice of OpenRouter's payload we map from; anything else is ignored. */
const UpstreamModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    context_length: z.number().int().positive().nullable().optional(),
    pricing: z
      .object({
        // USD per token, as a decimal string.
        prompt: z.string().optional(),
        completion: z.string().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const UpstreamResponseSchema = z.object({ data: z.array(z.unknown()) });

/** USD/token string → USD per 1k tokens; null when absent or unparsable. */
function per1k(perToken: string | undefined): number | null {
  if (perToken == null) return null;
  const n = Number(perToken);
  return Number.isFinite(n) ? n * 1000 : null;
}

export interface ModelsRoutesDeps {
  /** Test seam: replaces global fetch (no live network in tests). */
  fetchFn?: typeof fetch;
  logger?: Logger;
}

/** Express 4 does not forward async rejections to the error middleware. */
function ah(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export function registerModelsRoutes(app: Express, deps: ModelsRoutesDeps = {}): void {
  const fetchFn = deps.fetchFn ?? fetch;
  const cache = new Map<CatalogType, { at: number; models: Model[] }>();

  app.get(
    '/api/models',
    ah(async (req, res) => {
      const { type } = ListModelsQuerySchema.parse(req.query ?? {});
      const hit = cache.get(type);
      if (hit && Date.now() - hit.at < MODELS_CACHE_TTL_MS) {
        res.json(ListModelsResponseSchema.parse({ models: hit.models }));
        return;
      }

      let json: unknown;
      try {
        const upstream = await fetchFn(UPSTREAM_URLS[type]);
        if (!upstream.ok) throw new Error(`openrouter responded ${upstream.status}`);
        json = await upstream.json();
      } catch (err) {
        throw new HttpError(502, 'UNPROCESSABLE', 'could not fetch the OpenRouter model list', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }

      const envelope = UpstreamResponseSchema.safeParse(json);
      const rows = envelope.success
        ? z.array(UpstreamModelSchema).safeParse(envelope.data.data)
        : null;
      if (!rows?.success) {
        deps.logger?.warn({ type }, 'unexpected OpenRouter models payload');
        throw new HttpError(502, 'UNPROCESSABLE', 'unexpected OpenRouter models payload');
      }

      const models: Model[] = rows.data.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        contextLength: m.context_length ?? null,
        pricingPromptPer1k: per1k(m.pricing?.prompt),
        pricingCompletionPer1k: per1k(m.pricing?.completion),
      }));
      cache.set(type, { at: Date.now(), models });
      res.json(ListModelsResponseSchema.parse({ models }));
    }),
  );
}
