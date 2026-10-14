import { ListJobsResponseSchema } from '@tubescribe/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApiRequestError, apiFetch } from './client.ts';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(impl: typeof fetch) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('parses a successful response with the given schema', async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(jsonResponse({ jobs: [] })));

    const result = await apiFetch(ListJobsResponseSchema, '/jobs');

    expect(result).toEqual({ jobs: [] });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('/api/jobs');
  });

  it('sends JSON bodies with a JSON content-type header', async () => {
    const fetchSpy = stubFetch(() => Promise.resolve(jsonResponse({ jobs: [] })));

    await apiFetch(ListJobsResponseSchema, '/jobs', {
      method: 'POST',
      body: { status: 'running' },
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ status: 'running' }));
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('normalizes shared error responses to ApiRequestError', async () => {
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'job not found: abc',
              details: { field: 'id' },
            },
          },
          404,
        ),
      ),
    );

    const err = await catchError(apiFetch(ListJobsResponseSchema, '/jobs/abc'));

    expect(err).toBeInstanceOf(ApiRequestError);
    const apiErr = err as ApiRequestError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.code).toBe('NOT_FOUND');
    expect(apiErr.message).toBe('job not found: abc');
    expect(apiErr.details).toEqual({ field: 'id' });
  });

  it('falls back to INTERNAL when the error body is not the shared shape', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502 })));

    const err = await catchError(apiFetch(ListJobsResponseSchema, '/jobs'));

    expect(err).toBeInstanceOf(ApiRequestError);
    const apiErr = err as ApiRequestError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.code).toBe('INTERNAL');
  });

  it('throws a ZodError when a success payload drifts from the schema', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ jobs: [{ nope: true }] })));

    await expect(apiFetch(ListJobsResponseSchema, '/jobs')).rejects.toBeInstanceOf(ZodError);
  });

  it('wraps network failures as INTERNAL ApiRequestError with status 0', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')));

    const err = await catchError(apiFetch(ListJobsResponseSchema, '/jobs'));

    expect(err).toBeInstanceOf(ApiRequestError);
    const apiErr = err as ApiRequestError;
    expect(apiErr.status).toBe(0);
    expect(apiErr.code).toBe('INTERNAL');
    expect(apiErr.message).toBe('connection refused');
  });
});
