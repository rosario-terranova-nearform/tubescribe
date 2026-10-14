import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from './router.tsx';

function stubJobs(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
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
    stubJobs({ jobs: [] });
    renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument();
  });

  const pages = [
    ['/sources', 'Sources'],
    ['/sources/src_1', 'Source detail'],
    ['/bots', 'Bots'],
    ['/bots/new', 'New bot'],
    ['/bots/bot_1/edit', 'Edit bot'],
    ['/bots/bot_1', 'Bot chat'],
    ['/settings', 'Settings'],
  ] as const;

  it.each(pages)('renders %s under the app layout', async (path, heading) => {
    stubJobs({ jobs: [] });
    renderRoute(path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    // AppLayout chrome is present on every route.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('shows the route param on detail pages', async () => {
    stubJobs({ jobs: [] });
    renderRoute('/sources/abc123');
    await screen.findByRole('heading', { name: 'Source detail' });
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('navigates between pages via the header nav', async () => {
    stubJobs({ jobs: [] });
    renderRoute('/sources');
    await screen.findByRole('heading', { name: 'Sources' });

    fireEvent.click(screen.getByRole('link', { name: 'Bots' }));
    expect(await screen.findByRole('heading', { name: 'Bots' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  describe('GlobalJobIndicator', () => {
    it('stays hidden when no job is queued or running', async () => {
      stubJobs({ jobs: [] });
      renderRoute('/sources');
      await screen.findByRole('heading', { name: 'Sources' });
      expect(screen.queryByTestId('global-job-indicator')).not.toBeInTheDocument();
    });

    it('shows active job progress while a job runs', async () => {
      stubJobs({
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
