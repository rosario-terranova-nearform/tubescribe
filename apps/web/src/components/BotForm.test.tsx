import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Bot } from '@tubescribe/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotForm } from './BotForm.tsx';

const SOURCES = [
  {
    id: 'src_1',
    kind: 'channel',
    identifier: '@testchannel',
    title: 'Test channel',
    thumbnailUrl: null,
    channelId: 'UC123',
    channelTitle: null,
    videoCount: 3,
    typeFilter: { uploads: true, shorts: false, live: false },
    createdAt: '2026-10-15T00:00:00.000Z',
    status: { total: 3, pending: 0, fetched: 3, failed: 0, embedded: 3 },
  },
  {
    id: 'src_2',
    kind: 'playlist',
    identifier: 'PLabc',
    title: 'Test playlist',
    thumbnailUrl: null,
    channelId: null,
    channelTitle: null,
    videoCount: 5,
    typeFilter: { uploads: true, shorts: true, live: false },
    createdAt: '2026-10-15T00:00:00.000Z',
    status: { total: 5, pending: 0, fetched: 5, failed: 0, embedded: 5 },
  },
];

const SETTINGS = {
  defaultChatModel: 'openai/gpt-4o',
  defaultEmbeddingModel: 'openai/text-embedding-3-small',
  youtubeRequestDelayMsMin: 1000,
  youtubeRequestDelayMsMax: 3000,
  transcriptFetchConcurrency: 1,
};

const BOT: Bot = {
  id: 'bot_1',
  name: 'Existing bot',
  systemPrompt: 'You are helpful.',
  modelOverride: 'anthropic/claude-sonnet-4',
  sourceIds: ['src_1'],
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
};

const MODELS = [
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Anthropic: Claude Sonnet 4',
    contextLength: 200000,
    pricingPromptPer1k: 0.003,
    pricingCompletionPer1k: 0.015,
  },
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface StubRoutes {
  create?: Response;
  update?: Response;
}

function stubFetch(routes: StubRoutes = {}) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/bots') && method === 'POST') {
      return Promise.resolve(routes.create ?? jsonResponse({ bot: BOT }, 201));
    }
    if (url.endsWith(`/api/bots/${BOT.id}`) && method === 'PUT') {
      return Promise.resolve(routes.update ?? jsonResponse({ bot: BOT }));
    }
    if (url.endsWith('/api/sources') && method === 'GET') {
      return Promise.resolve(jsonResponse({ sources: SOURCES }));
    }
    if (url.endsWith('/api/settings') && method === 'GET') {
      return Promise.resolve(jsonResponse({ settings: SETTINGS }));
    }
    if (url.includes('/api/models') && method === 'GET') {
      return Promise.resolve(jsonResponse({ models: MODELS }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderForm({ bot }: { bot?: Bot } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[bot ? '/edit' : '/new']}>
        <Routes>
          <Route path="/new" element={<BotForm />} />
          <Route path="/edit" element={<BotForm bot={bot} />} />
          <Route path="/bots" element={<p>bots list</p>} />
          <Route path="/bots/:id" element={<p>bot chat</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillName(value: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value } });
}

function fillSystemPrompt(value: string) {
  fireEvent.change(screen.getByLabelText('System prompt'), { target: { value } });
}

async function checkFirstSource() {
  fireEvent.click(await screen.findByRole('checkbox', { name: /Test channel/ }));
}

/** Requests to POST /api/bots observed by the fetch spy. */
function postsToBots(spy: ReturnType<typeof stubFetch>) {
  return spy.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/api/bots') && init?.method === 'POST',
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BotForm validation', () => {
  it('requires a name', async () => {
    const spy = stubFetch();
    renderForm();
    fillSystemPrompt('Be helpful.');
    await checkFirstSource();
    fireEvent.click(screen.getByRole('button', { name: 'Create bot' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(postsToBots(spy)).toHaveLength(0);
  });

  it('requires a system prompt', async () => {
    stubFetch();
    renderForm();
    fillName('My bot');
    await checkFirstSource();
    fireEvent.click(screen.getByRole('button', { name: 'Create bot' }));
    expect(await screen.findByText('System prompt is required')).toBeInTheDocument();
  });

  it('requires at least one source', async () => {
    const spy = stubFetch();
    renderForm();
    fillName('My bot');
    fillSystemPrompt('Be helpful.');
    await screen.findByRole('checkbox', { name: /Test channel/ });
    fireEvent.click(screen.getByRole('button', { name: 'Create bot' }));
    expect(await screen.findByText('Attach at least one source')).toBeInTheDocument();
    expect(postsToBots(spy)).toHaveLength(0);
  });
});

describe('BotForm submit', () => {
  it('creates a bot with the entered values and navigates to its chat', async () => {
    const spy = stubFetch();
    renderForm();
    fillName('Research bot');
    fillSystemPrompt('Answer from my corpus.');
    await checkFirstSource();
    fireEvent.click(screen.getByRole('button', { name: 'Create bot' }));

    expect(await screen.findByText('bot chat')).toBeInTheDocument();
    const calls = postsToBots(spy);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      name: 'Research bot',
      systemPrompt: 'Answer from my corpus.',
      modelOverride: null,
      sourceIds: ['src_1'],
    });
  });

  it('shows server errors inline', async () => {
    stubFetch({
      create: jsonResponse(
        {
          error: {
            code: 'VALIDATION',
            message: 'unknown source ids',
            details: {
              field: 'sourceIds',
              reason: 'every sourceId must reference an existing source',
            },
          },
        },
        400,
      ),
    });
    renderForm();
    fillName('My bot');
    fillSystemPrompt('Be helpful.');
    await checkFirstSource();
    fireEvent.click(screen.getByRole('button', { name: 'Create bot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'unknown source ids: every sourceId must reference an existing source',
    );
  });

  it('updates a bot, clearing the model override when Default is picked', async () => {
    const spy = stubFetch();
    renderForm({ bot: BOT });

    // Existing values are pre-filled.
    expect(screen.getByLabelText('Name')).toHaveValue('Existing bot');
    const sourceCheckbox = await screen.findByRole('checkbox', { name: /Test channel/ });
    expect(sourceCheckbox).toHaveAttribute('aria-checked', 'true');

    // Clear the override via the picker's Default option.
    fireEvent.click(screen.getByRole('combobox', { name: 'Chat model' }));
    fireEvent.click(await screen.findByRole('option', { name: /Default \(openai\/gpt-4o\)/ }));

    fillName('Renamed bot');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('bots list')).toBeInTheDocument();
    const puts = spy.mock.calls.filter(
      ([url, init]) => String(url).endsWith(`/api/bots/${BOT.id}`) && init?.method === 'PUT',
    );
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String(puts[0]?.[1]?.body))).toEqual({
      name: 'Renamed bot',
      systemPrompt: 'You are helpful.',
      modelOverride: null,
      sourceIds: ['src_1'],
    });
  });
});
