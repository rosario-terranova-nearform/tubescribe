import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Settings } from '@tubescribe/shared';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from './SettingsForm.tsx';

const SETTINGS: Settings = {
  defaultChatModel: 'openai/gpt-4o-mini',
  defaultEmbeddingModel: 'openai/text-embedding-3-small',
  youtubeRequestDelayMsMin: 1000,
  youtubeRequestDelayMsMax: 3000,
  transcriptFetchConcurrency: 1,
};

const CHAT_MODELS = [
  {
    id: 'openai/gpt-4o-mini',
    name: 'OpenAI: GPT-4o mini',
    contextLength: 128000,
    pricingPromptPer1k: 0.00015,
    pricingCompletionPer1k: 0.0006,
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Anthropic: Claude Sonnet 4',
    contextLength: 200000,
    pricingPromptPer1k: 0.003,
    pricingCompletionPer1k: 0.015,
  },
];

const EMBEDDING_MODELS = [
  {
    id: 'openai/text-embedding-3-small',
    name: 'OpenAI: Text Embedding 3 Small',
    contextLength: 8191,
    pricingPromptPer1k: 0.00002,
    pricingCompletionPer1k: null,
  },
  {
    id: 'openai/text-embedding-3-large',
    name: 'OpenAI: Text Embedding 3 Large',
    contextLength: 8191,
    pricingPromptPer1k: 0.00013,
    pricingCompletionPer1k: null,
  },
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface StubRoutes {
  update?: Response;
}

function stubFetch(routes: StubRoutes = {}) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/models') && url.includes('type=embedding')) {
      return Promise.resolve(jsonResponse({ models: EMBEDDING_MODELS }));
    }
    if (url.includes('/api/models')) {
      return Promise.resolve(jsonResponse({ models: CHAT_MODELS }));
    }
    if (url.endsWith('/api/settings') && method === 'PUT') {
      if (routes.update) return Promise.resolve(routes.update);
      const body = JSON.parse(String(init?.body)) as Settings;
      return Promise.resolve(
        jsonResponse({ settings: { ...SETTINGS, ...body }, openrouterKeyConfigured: true }),
      );
    }
    if (url.endsWith('/api/settings')) {
      return Promise.resolve(jsonResponse({ settings: SETTINGS, openrouterKeyConfigured: true }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderForm(settings: Settings = SETTINGS) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsForm settings={settings} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pickModel(comboboxName: string, optionName: RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: comboboxName }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsForm', () => {
  it('shows the current defaults on the picker triggers', () => {
    stubFetch();
    renderForm();
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toHaveTextContent(
      'openai/gpt-4o-mini',
    );
    expect(screen.getByRole('combobox', { name: 'Embedding model' })).toHaveTextContent(
      'openai/text-embedding-3-small',
    );
  });

  it('warns about reindexing only after the embedding model changes', async () => {
    stubFetch();
    renderForm();
    expect(screen.queryByText(/changing the embedding model/i)).not.toBeInTheDocument();

    await pickModel('Embedding model', /Text Embedding 3 Large/);

    const warning = await screen.findByText(/changing the embedding model/i);
    expect(warning).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reindex all sources/i })).toHaveAttribute(
      'href',
      '/sources',
    );
  });

  it('saves both model ids via PUT /api/settings', async () => {
    const fetchSpy = stubFetch();
    renderForm();
    await pickModel('Chat model', /Claude Sonnet 4/);

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await screen.findByRole('button', { name: 'Save settings' }); // settles after save
    const putCall = fetchSpy.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/settings') && init?.method === 'PUT',
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      defaultChatModel: 'anthropic/claude-sonnet-4',
      defaultEmbeddingModel: 'openai/text-embedding-3-small',
    });
  });

  it('surfaces server validation errors with the shared error shape', async () => {
    stubFetch({
      update: jsonResponse(
        {
          error: {
            code: 'VALIDATION',
            message: 'Request validation failed',
            details: {
              field: 'defaultChatModel',
              reason: 'Too small: expected string to have >=1 characters',
            },
          },
        },
        400,
      ),
    });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Request validation failed: Too small/,
    );
  });
});
