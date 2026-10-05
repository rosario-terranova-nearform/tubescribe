// API error schema tests.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiErrorSchema, ApiSuccessEnvelopeSchema } from './errors.js';

describe('ApiErrorSchema', () => {
  it('parses a minimal error', () => {
    const v = { error: { code: 'INTERNAL', message: 'boom' } };
    expect(ApiErrorSchema.parse(v)).toEqual(v);
  });

  it('parses an error with structured details', () => {
    const v = {
      error: {
        code: 'VALIDATION',
        message: 'invalid body',
        details: { field: 'name', reason: 'too short' },
      },
    };
    expect(ApiErrorSchema.parse(v)).toEqual(v);
  });

  it('passes through arbitrary keys inside details', () => {
    const v = {
      error: {
        code: 'BAD_REQUEST',
        message: 'invalid',
        details: { field: 'x', reason: 'y', extra: { nested: true } },
      },
    };
    expect(ApiErrorSchema.parse(v)).toEqual(v);
  });

  it('rejects unknown top-level keys', () => {
    const v = { error: { code: 'INTERNAL', message: 'boom' }, ok: true };
    expect(() => ApiErrorSchema.parse(v)).toThrow();
  });

  it('rejects unknown error codes', () => {
    const v = { error: { code: 'NOT_A_CODE', message: 'x' } };
    expect(() => ApiErrorSchema.parse(v)).toThrow();
  });
});

describe('ApiSuccessEnvelopeSchema', () => {
  it('round-trips a wrapped payload', () => {
    const Schema = ApiSuccessEnvelopeSchema(z.object({ id: z.string() }));
    const parsed = Schema.parse({ ok: true, data: { id: 'abc' } });
    expect(parsed).toEqual({ ok: true, data: { id: 'abc' } });
  });
});
