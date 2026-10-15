import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddSourceBox } from './AddSourceBox.tsx';

const SUGGESTION = {
  kind: 'channel',
  identifier: 'UCtest123',
  title: 'Test Channel',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  channelTitle: null,
  videoCount: 42,
  duplicate: false,
};

const NEW_SOURCE = {
  id: 'src_new',
  kind: 'channel',
  identifier: 'UCtest123',
  title: 'Test Channel',
  thumbnailUrl: null,
  channelId: null,
  channelTitle: null,
  videoCount: 42,
  typeFilter: { uploads: true, shorts: false, live: false },
  createdAt: '2026-10-15T00:00:00.000Z',
};

const EXISTING_SOURCE = {
  ...NEW_SOURCE,
  id: 'src_existing',
  status: { total: 42, pending: 0, fetched: 40, failed: 2, embedded: 38 },
};

const NEW_JOB = {
  id: 'job_1',
  kind: 'extract',
  sourceId: 'src_new',
  status: 'queued',
  startedAt: '2026-10-15T00:00:00.000Z',
  finishedAt: null,
  totalItems: 42,
  processedItems: 0,
  failedItems: 0,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface StubRoutes {
  /** Response (or deferred factory) for POST /api/sources/resolve. Defaults to SUGGESTION. */
  resolve?: Response | (() => Promise<Response>);
  /** Response for POST /api/sources. Defaults to 201 with NEW_SOURCE + NEW_JOB. */
  create?: Response;
  /** Payload for GET /api/sources (used for the duplicate link). */
  sources?: unknown;
}

function stubFetch(routes: StubRoutes = {}) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/api/sources/resolve') && method === 'POST') {
      if (typeof routes.resolve === 'function') return routes.resolve();
      return Promise.resolve(routes.resolve ?? jsonResponse({ suggestion: SUGGESTION }));
    }
    if (url.endsWith('/api/sources') && method === 'POST') {
      return Promise.resolve(
        routes.create ?? jsonResponse({ source: NEW_SOURCE, job: NEW_JOB }, 201),
      );
    }
    if (url.endsWith('/api/sources') && method === 'GET') {
      return Promise.resolve(jsonResponse(routes.sources ?? { sources: [] }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function renderBox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AddSourceBox />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pasteAndSubmit(value: string) {
  fireEvent.change(screen.getByLabelText('YouTube source link'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddSourceBox', () => {
  it('renders the idle state: empty input, enabled Add button, no preview', () => {
    stubFetch();
    renderBox();

    const input = screen.getByLabelText('YouTube source link');
    expect(input).toHaveValue('');
    expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the form while resolving', async () => {
    let release: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolvePromise) => {
      release = resolvePromise;
    });
    stubFetch({ resolve: () => pending });
    renderBox();

    pasteAndSubmit('https://www.youtube.com/@test');

    expect(await screen.findByRole('button', { name: 'Resolving…' })).toBeDisabled();
    expect(screen.getByLabelText('YouTube source link')).toBeDisabled();

    // Release so the mutation settles before teardown.
    release?.(jsonResponse({ suggestion: SUGGESTION }));
    expect(await screen.findByTestId('source-preview')).toBeInTheDocument();
  });

  it('shows the confirmation card and creates the source with the chosen type filter', async () => {
    const fetchSpy = stubFetch();
    renderBox();

    pasteAndSubmit('https://www.youtube.com/@test');

    // Preview: kind badge, title, thumbnail, video count, type-filter checkboxes.
    const preview = await screen.findByTestId('source-preview');
    expect(preview).toHaveTextContent('channel');
    expect(preview).toHaveTextContent('Test Channel');
    expect(preview).toHaveTextContent('42 videos');
    expect(preview.querySelector('img')).toHaveAttribute('src', SUGGESTION.thumbnailUrl);
    expect(screen.getByRole('checkbox', { name: 'uploads' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'shorts' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'live' })).not.toBeChecked();
    expect(preview).toHaveTextContent(/type filter is fixed/i);

    // Opt into live streams, then confirm.
    fireEvent.click(screen.getByRole('checkbox', { name: 'live' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));

    // (GET /api/sources also fires on mount and after the create invalidation,
    // so match calls by URL + method instead of relying on call order.)
    await vi.waitFor(() => {
      const createCall = fetchSpy.mock.calls.find(
        ([url, init]) => String(url).endsWith('/api/sources') && init?.method === 'POST',
      );
      expect(createCall).toBeDefined();
      expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
        kind: 'channel',
        identifier: 'UCtest123',
        typeFilter: { uploads: true, shorts: false, live: true },
      });
    });
    const resolveCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).endsWith('/api/sources/resolve'),
    );
    expect(JSON.parse(String(resolveCall?.[1]?.body))).toEqual({
      input: 'https://www.youtube.com/@test',
    });
    // Back to idle after a successful add.
    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument();
  });

  it('shows the server reason inline for invalid input (400)', async () => {
    stubFetch({
      resolve: jsonResponse(
        {
          error: {
            code: 'VALIDATION',
            message: 'unrecognizable source input',
            details: { field: 'input', reason: 'not a YouTube URL' },
          },
        },
        400,
      ),
    });
    renderBox();

    pasteAndSubmit('not a link');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'unrecognizable source input: not a YouTube URL',
    );
    expect(screen.queryByTestId('source-preview')).not.toBeInTheDocument();
    expect(screen.getByLabelText('YouTube source link')).toBeEnabled();
  });

  it('warns and disables adding when resolve flags the source as a duplicate', async () => {
    stubFetch({
      resolve: jsonResponse({ suggestion: { ...SUGGESTION, duplicate: true } }),
      sources: { sources: [EXISTING_SOURCE] },
    });
    renderBox();

    pasteAndSubmit('https://www.youtube.com/@test');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already in your library/);
    const link = screen.getByRole('link', { name: 'View existing source' });
    expect(link).toHaveAttribute('href', '/sources/src_existing');
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });

  it('warns with a link to the existing source when create returns 409', async () => {
    stubFetch({
      create: jsonResponse(
        {
          error: {
            code: 'CONFLICT',
            message: 'source already exists: UCtest123',
            details: { field: 'identifier' },
          },
        },
        409,
      ),
      sources: { sources: [EXISTING_SOURCE] },
    });
    renderBox();

    pasteAndSubmit('https://www.youtube.com/@test');
    fireEvent.click(await screen.findByRole('button', { name: 'Add source' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already in your library/);
    expect(screen.getByRole('link', { name: 'View existing source' })).toHaveAttribute(
      'href',
      '/sources/src_existing',
    );
    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });
});
