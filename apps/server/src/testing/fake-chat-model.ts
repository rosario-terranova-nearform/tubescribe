// Fake ChatModelFactory for tests, backed by ai/test MockLanguageModelV4.
// Records requested model ids (to assert modelOverride/settings resolution)
// and streams scripted text deltas — no network, ever.
// Excluded from the production build (see tsconfig.build.json).

import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import type { ChatModelFactory } from '../chat.js';

export interface FakeChatModel {
  factory: ChatModelFactory;
  /** Model ids the factory was called with, in order. */
  requestedModelIds: string[];
  /** The underlying mock; `doStreamCalls` holds the resolved prompts. */
  mock: MockLanguageModelV4;
}

export interface FakeChatModelOptions {
  /** Text deltas the mock streams, in order (default: ['Hello', ' world']). */
  deltas?: string[];
  /** When set, doStream throws this error instead of streaming. */
  error?: Error;
}

export function fakeChatModel(options: FakeChatModelOptions = {}): FakeChatModel {
  const deltas = options.deltas ?? ['Hello', ' world'];
  const requestedModelIds: string[] = [];
  const mock = new MockLanguageModelV4({
    doStream: options.error
      ? () => Promise.reject(options.error)
      : () =>
          Promise.resolve({
            stream: convertArrayToReadableStream([
              { type: 'text-start', id: 'text-1' },
              ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 'text-1', delta })),
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: 'stop' },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: deltas.length, text: deltas.length, reasoning: 0 },
                },
              },
            ]),
          }),
  });
  return {
    mock,
    requestedModelIds,
    factory: (modelId) => {
      requestedModelIds.push(modelId);
      return mock;
    },
  };
}
