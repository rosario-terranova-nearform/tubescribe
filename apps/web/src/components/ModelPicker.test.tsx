import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from './ModelPicker.tsx';

const MODELS = [
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    contextLength: 128000,
    pricingPromptPer1k: 0.0025,
    pricingCompletionPer1k: 0.01,
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Anthropic: Claude Sonnet 4',
    contextLength: 200000,
    pricingPromptPer1k: 0.003,
    pricingCompletionPer1k: 0.015,
  },
];

const SETTINGS = {
  defaultChatModel: 'openai/gpt-4o',
  defaultEmbeddingModel: 'openai/text-embedding-3-small',
  youtubeRequestDelayMsMin: 1000,
  youtubeRequestDelayMsMax: 3000,
  transcriptFetchConcurrency: 1,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface StubRoutes {
  models?: Response | (() => Promise<Response>);
}

function stubFetch(routes: StubRoutes = {}) {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/models')) {
      if (typeof routes.models === 'function') return routes.models();
      return Promise.resolve(routes.models ?? jsonResponse({ models: MODELS }));
    }
    if (url.endsWith('/api/settings')) {
      return Promise.resolve(jsonResponse({ settings: SETTINGS, openrouterKeyConfigured: true }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderPicker(props: Partial<ComponentProps<typeof ModelPicker>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = props.onChange ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ModelPicker value={null} onChange={onChange} {...props} />
    </QueryClientProvider>,
  );
  return { onChange };
}

function openPicker() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Chat model' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModelPicker', () => {
  it('labels the empty selection with the global default from settings', async () => {
    stubFetch();
    renderPicker();
    expect(await screen.findByText('Default (openai/gpt-4o)')).toBeInTheDocument();
  });

  it('shows a loading state while the catalog loads', async () => {
    stubFetch({ models: () => new Promise<Response>(() => {}) });
    renderPicker();
    openPicker();
    expect(await screen.findByText('Loading models…')).toBeInTheDocument();
  });

  it('shows an error state when the catalog fails to load', async () => {
    stubFetch({
      models: jsonResponse(
        {
          error: { code: 'UNPROCESSABLE', message: 'could not fetch the OpenRouter model list' },
        },
        502,
      ),
    });
    renderPicker();
    openPicker();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load models: could not fetch the OpenRouter model list',
    );
  });

  it('filters the catalog and shows an empty state on no match', async () => {
    stubFetch();
    renderPicker();
    openPicker();
    await screen.findByRole('option', { name: /Claude Sonnet 4/ });

    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No models match/)).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('calls onChange with the model id when a model is selected', async () => {
    stubFetch();
    const { onChange } = renderPicker();
    openPicker();
    fireEvent.click(await screen.findByRole('option', { name: /Claude Sonnet 4/ }));
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-sonnet-4');
  });

  it('calls onChange with null when the default option is selected', async () => {
    stubFetch();
    const { onChange } = renderPicker({ value: 'anthropic/claude-sonnet-4' });
    openPicker();
    fireEvent.click(await screen.findByRole('option', { name: /Default \(openai\/gpt-4o\)/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('fetches the embedding catalog when type="embedding"', async () => {
    const spy = stubFetch();
    renderPicker({ type: 'embedding', label: 'Embedding model' });
    fireEvent.click(screen.getByRole('combobox', { name: 'Embedding model' }));
    await screen.findByRole('option', { name: /GPT-4o/ });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/api/models?type=embedding'),
      expect.anything(),
    );
  });

  it('hides the default option and shows a placeholder when allowDefault is false', async () => {
    stubFetch();
    renderPicker({ allowDefault: false });
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toHaveTextContent(
      'Select a model…',
    );
    openPicker();
    await screen.findByRole('option', { name: /GPT-4o/ });
    expect(screen.queryByRole('option', { name: /Default \(/ })).not.toBeInTheDocument();
  });

  it('shows the selected model name once the catalog has loaded', async () => {
    stubFetch();
    renderPicker({ value: 'anthropic/claude-sonnet-4' });
    openPicker();
    await screen.findByRole('option', { name: /Claude Sonnet 4/ });
    expect(screen.getByRole('combobox', { name: 'Chat model' })).toHaveTextContent(
      'Anthropic: Claude Sonnet 4 (anthropic/claude-sonnet-4)',
    );
  });
});
