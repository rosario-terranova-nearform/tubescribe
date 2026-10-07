import { describe, expect, it } from 'vitest';
import { type TranscriptFixture, fakeInnertube, fakeVideoInfo } from '../__fixtures__/fakes.js';
import asrFixture from '../__fixtures__/transcript-asr.json' with { type: 'json' };
import manualFixture from '../__fixtures__/transcript-manual.json' with { type: 'json' };
import type { InnertubeLike } from '../types.js';
import { TranscriptError } from './engine.js';
import { type YoutubeiEngineName, YoutubeiTranscriptEngine } from './youtubei.js';

function engineFor(fixture: TranscriptFixture, name?: YoutubeiEngineName) {
  const client = fakeInnertube({ videoInfos: { [fixture.videoId]: fakeVideoInfo(fixture) } });
  return new YoutubeiTranscriptEngine(() => Promise.resolve(client), name);
}

function engineWithFailingClient(getInfo: InnertubeLike['getInfo']): YoutubeiTranscriptEngine {
  const client: InnertubeLike = { ...fakeInnertube({}), getInfo };
  return new YoutubeiTranscriptEngine(() => Promise.resolve(client));
}

describe('YoutubeiTranscriptEngine — normalization', () => {
  it('normalizes a manual transcript: language, kind, segments, fullText', async () => {
    const engine = engineFor(manualFixture);

    const result = await engine.fetch(manualFixture.videoId);

    expect(result.engine).toBe('youtubei.js');
    expect(result.language).toBe('en');
    expect(result.captionKind).toBe('manual');
    // Section headers are dropped; string timestamps become numbers.
    expect(result.segments).toEqual([
      { text: 'hello world', startMs: 1200, endMs: 3400 },
      { text: 'second line', startMs: 3400, endMs: 5900 },
    ]);
    expect(result.fullText).toBe('hello world\nsecond line');
  });

  it('normalizes an asr transcript via default_caption_track_index', async () => {
    const engine = engineFor(asrFixture);

    const result = await engine.fetch(asrFixture.videoId);

    expect(result.language).toBe('en');
    expect(result.captionKind).toBe('asr');
    expect(result.segments).toEqual([{ text: 'auto caption', startMs: 0, endMs: 2500 }]);
  });

  it('records the tv-embedded engine name when constructed with it', async () => {
    const engine = engineFor(manualFixture, 'youtubei.js-tv-embedded');

    const result = await engine.fetch(manualFixture.videoId);

    expect(result.engine).toBe('youtubei.js-tv-embedded');
  });

  it('throws unavailable when the transcript has no segments', async () => {
    const engine = engineFor({
      ...manualFixture,
      transcript: { ...manualFixture.transcript, segments: [] },
    });

    const err = await engine.fetch(manualFixture.videoId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('unavailable');
  });
});

describe('YoutubeiTranscriptEngine — error classification', () => {
  it('maps a missing transcript panel to unavailable', async () => {
    const info = fakeVideoInfo(manualFixture);
    info.getTranscript = () =>
      Promise.reject(new Error('Transcript panel not found. Video likely has no transcript.'));
    const client = fakeInnertube({ videoInfos: { [manualFixture.videoId]: info } });
    const engine = new YoutubeiTranscriptEngine(() => Promise.resolve(client));

    const err = await engine.fetch(manualFixture.videoId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('unavailable');
  });

  it('maps LOGIN_REQUIRED bot detection to rate-limited', async () => {
    const loginRequired = Object.assign(new Error('Video is login required'), {
      info: { error_type: 'LOGIN_REQUIRED' },
    });
    const engine = engineWithFailingClient(() => Promise.reject(loginRequired));

    const err = await engine.fetch('anyvideo001').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('rate-limited');
    expect((err as TranscriptError).videoId).toBe('anyvideo001');
  });

  it.each([400, 429, 500])('maps HTTP %i responses to rate-limited', async (status) => {
    const info = fakeVideoInfo(manualFixture);
    info.getTranscript = () =>
      Promise.reject(
        new Error(
          `Request to https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false failed with status code ${status}`,
        ),
      );
    const client = fakeInnertube({ videoInfos: { [manualFixture.videoId]: info } });
    const engine = new YoutubeiTranscriptEngine(() => Promise.resolve(client));

    const err = await engine.fetch(manualFixture.videoId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('rate-limited');
  });

  it('maps captions-disabled messages to disabled', async () => {
    const info = fakeVideoInfo(manualFixture);
    info.getTranscript = () => Promise.reject(new Error('Transcript is disabled on this video'));
    const client = fakeInnertube({ videoInfos: { [manualFixture.videoId]: info } });
    const engine = new YoutubeiTranscriptEngine(() => Promise.resolve(client));

    const err = await engine.fetch(manualFixture.videoId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscriptError);
    expect((err as TranscriptError).code).toBe('disabled');
  });

  it('rethrows unrecognized errors unwrapped', async () => {
    const weird = new TypeError('cannot read properties of undefined');
    const engine = engineWithFailingClient(() => Promise.reject(weird));

    const err = await engine.fetch('anyvideo001').catch((e: unknown) => e);
    expect(err).toBe(weird);
    expect(err).not.toBeInstanceOf(TranscriptError);
  });
});
