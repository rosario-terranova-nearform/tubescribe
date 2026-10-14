import { Navigate, type RouteObject, createBrowserRouter } from 'react-router';
import { AppLayout } from './components/AppLayout.tsx';
import { BotChatPage } from './pages/BotChatPage.tsx';
import { BotEditPage } from './pages/BotEditPage.tsx';
import { BotNewPage } from './pages/BotNewPage.tsx';
import { BotsPage } from './pages/BotsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SourceDetailPage } from './pages/SourceDetailPage.tsx';
import { SourcesPage } from './pages/SourcesPage.tsx';

/**
 * Route table. Feature pages are placeholders until tasks 10-13 fill them in.
 * Exported separately from the browser router so tests can mount the same
 * table in a memory router.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/sources" replace /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'sources/:id', element: <SourceDetailPage /> },
      { path: 'bots', element: <BotsPage /> },
      { path: 'bots/new', element: <BotNewPage /> },
      { path: 'bots/:id/edit', element: <BotEditPage /> },
      { path: 'bots/:id', element: <BotChatPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
