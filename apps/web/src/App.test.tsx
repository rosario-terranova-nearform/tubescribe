import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './App.tsx';

describe('<App />', () => {
  beforeEach(() => {
    // Stub /api/health so the render stays deterministic and we don't trip
    // React 19's act() warning on the background fetch.
    globalThis.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterEach(() => {
    (globalThis as { fetch?: typeof fetch }).fetch = undefined;
  });

  it('renders the tubescribe heading', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /tubescribe/i })).toBeInTheDocument();
  });
});
