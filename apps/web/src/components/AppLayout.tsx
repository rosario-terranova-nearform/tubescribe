import { cn } from '@/lib/utils.ts';
import { NavLink, Outlet } from 'react-router';
import { GlobalJobIndicator } from './GlobalJobIndicator.tsx';

const NAV_ITEMS = [
  { to: '/sources', label: 'Sources' },
  { to: '/bots', label: 'Bots' },
  { to: '/settings', label: 'Settings' },
] as const;

export function AppLayout() {
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <NavLink to="/sources" className="text-base font-semibold tracking-tight">
            tubescribe
          </NavLink>
          <nav aria-label="Primary" className="flex flex-1 items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <GlobalJobIndicator />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
