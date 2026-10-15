import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from './router.tsx';

const SOURCE_FIXTURE = {
  kind: 'channel',
  title: 'Test source',
  thumbnailUrl: null,
  channelId: null,
  channelTitle: null,
  videoCount: 0,
  typeFilter: { uploads: true, shorts: false, live: false },
  createdAt: '2026-10-15T00:00:00.000Z',
  status: { total: 0, pending: 0, fetched: 0, failed: 0, embedded: 0 },
};

/** Stubs every endpoint the app shell + sources pages call, dispatched by URL. */
function stubApi(jobsPayload: unknown = { jobs: [] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown;
      const sourceMatch = /\/api\/sources\/([^/?]+)/.exec(url);
      if (url.includes('/api/jobs')) payload = jobsPayload;
      else if (sourceMatch && /\/videos(\?|$)/.test(url)) {
        payload = { videos: [], total: 0, limit: 500, offset: 0 };
      } else if (sourceMatch) {
        payload = { source: { ...SOURCE_FIXTURE, id: sourceMatch[1], identifier: sourceMatch[1] } };
      } else if (url.endsWith('/api/sources')) payload = { sources: [] };
      else return Promise.reject(new Error(`unexpected fetch: ${url}`));
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
}

function renderRoute(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('router', () => {
  it('redirects / to /sources', async () => {
    stubApi();
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument();
  });

  const pages = [
    ['/sources', 'Sources'],
    ['/sources/src_1', 'Test source'],
    ['/bots', 'Bots'],
    ['/bots/new', 'New bot'],
    ['/bots/bot_1/edit', 'Edit bot'],
    ['/bots/bot_1', 'Bot chat'],
    ['/settings', 'Settings'],
  ] as const;

  it.each(pages)('renders %s under the app layout', async (path, heading) => {
    stubApi();
    renderRoute(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    // AppLayout chrome is present on every route.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('shows the route param on detail pages', async () => {
    stubApi();
    renderRoute('/sources/abc123');
    await screen.findByRole('heading', { name: 'Test source' });
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('navigates between pages via the header nav', async () => {
    stubApi();
    renderRoute('/sources');
    await screen.findByRole('heading', { name: 'Sources' });

    fireEvent.click(screen.getByRole('link', { name: 'Bots' }));
    expect(await screen.findByRole('heading', { name: 'Bots' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  describe('GlobalJobIndicator', () => {
    it('stays hidden when no job is queued or running', async () => {
      stubApi();
      renderRoute('/sources');
      await screen.findByRole('heading', { name: 'Sources' });
      expect(screen.queryByTestId('global-job-indicator')).not.toBeInTheDocument();
    });

    it('shows active job progress while a job runs', async () => {
      stubApi({
        jobs: [
          {
            id: 'job_1',
            kind: 'extract',
            sourceId: 'src_1',
            status: 'running',
            startedAt: '2026-10-14T10:00:00.000Z',
            finishedAt: null,
            totalItems: 10,
            processedItems: 4,
            failedItems: 0,
          },
        ],
      });
      renderRoute('/sources');

      expect(await screen.findByTestId('global-job-indicator')).toBeInTheDocument();
      expect(screen.getByText('1 job running')).toBeInTheDocument();
    });
  });
});
