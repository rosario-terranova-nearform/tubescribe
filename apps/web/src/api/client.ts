// Typed fetch wrapper for the tubescribe API.
// - Requests go to `/api/*` (proxied to the Express server by Vite in dev).
// - Successful responses are parsed through shared zod schemas, so schema
//   drift between server and client fails fast with a ZodError.
// - Error responses are normalized to the shared ApiError shape and thrown as
//   ApiRequestError; network failures surface as code INTERNAL with status 0.

import {
  type ApiError,
  type ApiErrorCode,
  type ApiErrorDetails,
  ApiErrorSchema,
} from '@tubescribe/shared';
import type { z } from 'zod';

const API_BASE = '/api';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetails;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: ApiErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static fromApiError(status: number, apiError: ApiError): ApiRequestError {
    return new ApiRequestError(
      status,
      apiError.error.code,
      apiError.error.message,
      apiError.error.details,
    );
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** Serialized as JSON and sent with a JSON content-type when defined. */
  body?: unknown;
}

export async function apiFetch<S extends z.ZodType>(
  schema: S,
  path: string,
  options: ApiFetchOptions = {},
): Promise<z.output<S>> {
  const { body, headers, ...init } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // Network-level failure (server down, DNS, abort...).
    throw new ApiRequestError(
      0,
      'INTERNAL',
      cause instanceof Error ? cause.message : 'Network request failed',
      undefined,
      { cause },
    );
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) throw ApiRequestError.fromApiError(response.status, parsed.data);
    throw new ApiRequestError(
      response.status,
      'INTERNAL',
      `Request failed with status ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  return schema.parse(payload);
}
