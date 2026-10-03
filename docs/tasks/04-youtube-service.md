# Task 04: YouTube service: resolution, listing, transcript engines

**Status**: pending
**Depends on**: 03

## Goal

All YouTube access (keyless, youtubei.js) behind injectable, mockable interfaces. No route or job code touches youtubei.js directly.

## Scope

`apps/server/src/youtube/`:

- `types.ts`: `DiscoveredVideo { videoId, title, publishedAt, durationS }`, `ResolvedSource { kind, identifier, title, thumbnailUrl, videoCount? }`, `TranscriptResult { segments[{text,startMs,endMs}], fullText, language, captionKind, engine }`
- `client.ts`: Innertube factory (default client + `TV_EMBEDDED` variant)
- `resolve.ts`: channel (handle/UC/URL via `resolveURL`/`getChannel`), playlist (`getPlaylist`), video (`getBasicInfo`) → `ResolvedSource`
- `list.ts`: async generator listing videos of a source honoring its type filter (uploads / shorts / live) with continuation handling
- `engines/engine.ts`: `TranscriptEngine` interface `fetch(videoId) => Promise<TranscriptResult>` (throws typed errors: unavailable / disabled / rate-limited)
- `engines/youtubei.ts`: `getInfo` → `getTranscript()`; caption kind from `info.captions.caption_tracks[].kind` (`asr` = auto); language from selected track
- `engines/youtube-transcript.ts`: wrapper over the `youtube-transcript` package (v1.3.x API)
- `__fixtures__/`: recorded JSON for resolve/list/transcript cases

## Key decisions

- Bot-detection context: youtubei.js issues #1102 (transcript 400s), #1119 (`LOGIN_REQUIRED`, workaround `TV_EMBEDDED`); the engine abstraction plus task 05's fallback chain is the mitigation, do not bypass it
- youtubei.js is pure ESM; keep the whole repo ESM
- No live network in tests: mock at the `TranscriptEngine` / discovery interfaces

## Acceptance criteria

- [ ] Unit tests from fixtures: resolve (3 kinds), list pagination across continuations, type filter mapping
- [ ] Engine output normalization tested (manual vs asr, language code, segment timestamps)
- [ ] `pnpm test` green with zero network calls
