import { useEffect, useState } from 'react';

type Health = { ok: boolean };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // /api/health is proxied to the server by vite.config.ts during dev.
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>tubescribe</h1>
      <p>
        Scaffold online. Server status:{' '}
        {error ? (
          <span style={{ color: 'crimson' }}>{error}</span>
        ) : (
          <code>{JSON.stringify(health)}</code>
        )}
      </p>
    </main>
  );
}
