import { describe, expect, it } from 'vitest';
import { type HealthResponse, SHARED_PACKAGE_NAME } from './index.js';

describe('@tubescribe/shared', () => {
  it('exports its package name', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@tubescribe/shared');
  });

  it('exposes HealthResponse type (compile-time sanity check)', () => {
    const sample: HealthResponse = { ok: true };
    expect(sample.ok).toBe(true);
  });
});
