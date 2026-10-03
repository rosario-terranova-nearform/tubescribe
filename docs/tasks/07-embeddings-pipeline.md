# Task 07: Embeddings pipeline: chunker, sqlite-vec, retrieval

**Status**: pending
**Depends on**: 05

## Goal

Turn transcripts into searchable vectors: chunking, OpenRouter embeddings, sqlite-vec storage, source-scoped retrieval.

## Scope

`apps/server/src/embed/`:

- `chunker.ts`: ~500-token chunks, 10% overlap, aligned to transcript segment boundaries (never cut mid-timestamp range); each chunk carries `{ videoId, sourceId, title, startMs, endMs, text }`; tokenizer: `gpt-tokenizer` (pure JS)
- `embedder.ts`: Vercel AI SDK `embedMany` with `openrouter.textEmbeddingModel(...)`; batching (e.g. 100 texts per call) + retry with backoff; model from settings (`DEFAULT_EMBEDDING_MODEL` seed)
- `vec.ts`: `sqlite-vec` loaded via `sqliteVec.load(db)`; `vec_chunks` virtual table; dimension from the configured model (1536 for `text-embedding-3-small`)
- `index-job.ts`: embedding job chained automatically when an extraction job completes; per-video `embeddedAt`; skips already-embedded videos
- `retrieve.ts`: top-k (default 8) cosine similarity, filtered to a bot's attached sources (join chunks → videos → bot_sources)
- Route: `POST /api/sources/:id/reindex` (drops and rebuilds that source's chunks)

## Key decisions

- Chunks are keyed to **videos**, not bots: one embedding per chunk regardless of how many bots use the source
- Changing the embedding model changes dimensions: requires full reindex (document this in the route response / README)
- Mock the OpenRouter client in tests; no live network

## Acceptance criteria

- [ ] Chunker unit tests: overlap, timestamp alignment, citation metadata present, short transcripts (single chunk), empty transcript (no chunks)
- [ ] Integration: extraction job completion (fake engines) triggers embedding; `embeddedAt` set; `retrieve` returns only chunks from the bot's sources
- [ ] sqlite-vec round trip (insert + query) passes on this machine (darwin-arm64)
- [ ] `pnpm test` green
