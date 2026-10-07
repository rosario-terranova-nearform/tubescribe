import { describe, expect, it } from 'vitest';
import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from 'youtube-transcript';
import classicFixture from '../__fixtures__/youtube-transcript-classic.json' with { type: 'json' };
import srv3Fixture from '../__fixtures__/youtube-transcript-srv3.json' with { type: 'json' };
import { TranscriptError } from './engine.js';
import { YoutubeTranscriptEngine } from './youtube-transcript.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('YoutubeTranscriptEngine — normalization', () => {
  it('passes srv3 millisecond values through', async () => {
    const engine = new YoutubeTranscriptEngine(() => Promise.resolve(srv3Fixture.items));

    const result = await engine.fetch(VIDEO_ID);

    expect(result.engine).toBe('youtube-transcript');
    expect(result.language).toBe('en');
    // The package doesn't expose caption kind.
    expect(result.captionKind).toBeNull();
    expect(result.segments).toEqual([
      { text: 'hello world', startMs: 1200, endMs: 3400 },
      { text: 'second line', startMs: 3400, endMs: 5900 },
    ]);
    expect(result.fullText).toBe('hello world\nsecond line');
  });

  it('converts classic seconds values to milliseconds', async () => {
    const engine = new YoutubeTranscriptEngine(() => Promise.resolve(classicFixture.items));

    const result = await engine.fetch(VIDEO_ID);

    // Same wall-clock timestamps as the srv3 fixture.
    expect(result.segments).toEqual([
      { text: 'hello world', startMs: 1200, endMs: 3400 },
      { text: 'second line', startMs: 3400, endMs: 5900 },
    ]);
  });

  it('falls back to language "und" when items carry no lang', async () => {
    const engine = new YoutubeTranscriptEngine(() =>
      Promise.resolve([{ text: 'hi', offset: 0, duration: 1500 }]),
    );

    const result = await engine.fetch(VIDEO_ID);

    expect(result.language).toBe('und');
  });
});

describe('YoutubeTranscriptEngine — error classification', () => {
  it('maps TooManyRequest to rate-limited', async () => {
    const engine = new YoutubeTranscriptEngine(() =>
      Promise.reject(new YoutubeTranscriptTooManyRequestError()),
    );

    const err = await engine.fetch(VIDEO_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('rate-limited');
    expect((err as TranscriptError).videoId).toBe(VIDEO_ID);
  });

  it('maps Disabled to disabled', async () => {
    const engine = new YoutubeTranscriptEngine(() =>
      Promise.reject(new YoutubeTranscriptDisabledError(VIDEO_ID)),
    );

    const err = await engine.fetch(VIDEO_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('disabled');
  });

  it('maps NotAvailable / VideoUnavailable / NotAvailableLanguage to unavailable', async () => {
    const failures = [
      new YoutubeTranscriptNotAvailableError(VIDEO_ID),
      new YoutubeTranscriptVideoUnavailableError(VIDEO_ID),
      new YoutubeTranscriptNotAvailableLanguageError('fr', ['en'], VIDEO_ID),
    ];
    for (const failure of failures) {
      const engine = new YoutubeTranscriptEngine(() => Promise.reject(failure));
      const err = await engine.fetch(VIDEO_ID).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TranscriptError);
      expect((err as TranscriptError).code).toBe('unavailable');
    }
  });

  it('maps an empty transcript to unavailable', async () => {
    const engine = new YoutubeTranscriptEngine(() => Promise.resolve([]));

    const err = await engine.fetch(VIDEO_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('unavailable');
  });

  it('rethrows unrecognized errors unwrapped', async () => {
    const weird = new TypeError('fetch failed in an unexpected way');
    const engine = new YoutubeTranscriptEngine(() => Promise.reject(weird));

    const err = await engine.fetch(VIDEO_ID).catch((e: unknown) => e);
    expect(err).toBe(weird);
    expect(err).not.toBeInstanceOf(TranscriptError);
  });
});
