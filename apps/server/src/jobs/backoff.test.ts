import { describe, expect, it } from 'vitest';
import { backoffDelayMs, withBackoff } from './backoff.js';

const noSleep = (): Promise<void> => Promise.resolve();

describe('backoffDelayMs', () => {
  it('stays within [0, min(cap, base * 2^(attempt-1))]', () => {
    const randoms = [() => 0, () => 0.25, () => 0.5, () => 0.99999, Math.random];
    for (let attempt = 1; attempt <= 6; attempt++) {
      const bound = Math.min(10_000, 1000 * 2 ** (attempt - 1));
      for (const random of randoms) {
        for (let i = 0; i < 50; i++) {
          const delay = backoffDelayMs(attempt, 1000, 10_000, random);
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(bound);
          expect(Number.isInteger(delay)).toBe(true);
        }
      }
    }
  });

  it('is deterministic at the extremes of random()', () => {
    expect(backoffDelayMs(1, 1000, 10_000, () => 0)).toBe(0);
    // floor(0.9999 * 2001) = 2000 (attempt 2 → base * 2)
    expect(backoffDelayMs(2, 1000, 10_000, () => 0.9999)).toBe(2000);
    // floor(0.5 * 4001) = 2000 (attempt 3 → base * 4)
    expect(backoffDelayMs(3, 1000, 10_000, () => 0.5)).toBe(2000);
  });

  it('caps the pre-jitter bound', () => {
    // attempt 10 would be base * 512 uncapped; the cap must bind.
    for (let i = 0; i < 200; i++) {
      expect(backoffDelayMs(10, 1000, 3000)).toBeLessThanOrEqual(3000);
    }
  });
});

describe('withBackoff', () => {
  const baseOptions = {
    baseMs: 100,
    capMs: 10_000,
    maxRetries: 3,
    sleep: noSleep,
    random: () => 0.5,
    shouldRetry: () => true,
  };

  /** A sleep that records its delays. */
  const recordSleep =
    (sleeps: number[]) =>
    (ms: number): Promise<void> => {
      sleeps.push(ms);
      return noSleep();
    };

  it('returns immediately on first success, without sleeping', async () => {
    let calls = 0;
    const sleeps: number[] = [];

    const value = await withBackoff(
      () => {
        calls++;
        return Promise.resolve('ok');
      },
      { ...baseOptions, sleep: recordSleep(sleeps) },
    );

    expect(value).toBe('ok');
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries retryable failures with growing backoff, then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const retries: { attempt: number; delayMs: number }[] = [];

    const value = await withBackoff(
      () => {
        calls++;
        return calls < 3 ? Promise.reject(new Error('boom')) : Promise.resolve('ok');
      },
      {
        ...baseOptions,
        sleep: recordSleep(sleeps),
        onRetry: (_err, attempt, delayMs) => retries.push({ attempt, delayMs }),
      },
    );

    expect(value).toBe('ok');
    expect(calls).toBe(3);
    // random = 0.5 → attempt 1: floor(0.5 * 101) = 50, attempt 2: floor(0.5 * 201) = 100
    expect(sleeps).toEqual([50, 100]);
    expect(retries).toEqual([
      { attempt: 1, delayMs: 50 },
      { attempt: 2, delayMs: 100 },
    ]);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    const err = new Error('permanent');

    const caught = await withBackoff(
      () => {
        calls++;
        return Promise.reject(err);
      },
      { ...baseOptions, shouldRetry: () => false },
    ).catch((e: unknown) => e);

    expect(caught).toBe(err);
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const last = new Error('last');

    const caught = await withBackoff(
      () => {
        calls++;
        return Promise.reject(calls < 3 ? new Error(`fail ${calls}`) : last);
      },
      { ...baseOptions, maxRetries: 2, sleep: recordSleep(sleeps) },
    ).catch((e: unknown) => e);

    expect(caught).toBe(last);
    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(sleeps).toHaveLength(2);
  });
});
