// Typed error for expected HTTP failures. The error middleware in app.ts maps
// it onto the shared API error schema.

import type { ApiErrorCode } from '@tubescribe/shared';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: { field?: string; reason?: string },
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
