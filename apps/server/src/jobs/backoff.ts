// Jittered exponential backoff for transcript fetches (bot-detection defense,
// docs/DESIGN.md). Pure functions with injected timing — no env access here;
// the pipeline wires config values in.

export interface BackoffOptions {
  /** Delay basis: the first retry waits up to baseMs, each next one doubles it. */
  baseMs: number;
  /** Upper bound for the pre-jitter delay. */
  capMs: number;
  /** Retries allowed after the first attempt (TRANSCRIPT_MAX_RETRIES, default 3). */
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
  /** Random source in [0, 1) — injectable for deterministic tests. */
  random: () => number;
  /** Which errors are worth retrying (rate-limited TranscriptErrors). */
  shouldRetry: (err: unknown) => boolean;
  /** Called before each retry sleep, for observability. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Full-jitter backoff before retry `attempt` (1-based): a random integer in
 * [0, min(capMs, baseMs * 2^(attempt-1))].
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  const bound = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * (bound + 1));
}

/**
 * Run `fn`, retrying retryable failures with jittered exponential backoff.
 * After `maxRetries` retries the last error is rethrown; non-retryable errors
 * propagate immediately.
 */
export async function withBackoff<T>(fn: () => Promise<T>, options: BackoffOptions): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await fn();
    } catch (err) {
      if (retry >= options.maxRetries || !options.shouldRetry(err)) {
        throw err;
      }
      const delayMs = backoffDelayMs(retry + 1, options.baseMs, options.capMs, options.random);
      options.onRetry?.(err, retry + 1, delayMs);
      await options.sleep(delayMs);
    }
  }
}
