import { render, screen } from '@testing-library/react';
import type { Citation } from '@tubescribe/shared';
import { describe, expect, it } from 'vitest';
import { CitationChip } from './CitationChip.tsx';

const citation = (overrides: Partial<Citation> = {}): Citation => ({
  videoId: 'abc123',
  sourceId: 'src_1',
  title: 'Building a Second Brain',
  startMs: 83_000,
  endMs: 97_000,
  text: 'chunk text',
  ...overrides,
});

describe('CitationChip', () => {
  it('renders the [n] title @ mm:ss label', () => {
    render(<CitationChip citation={citation()} index={0} />);
    const chip = screen.getByRole('link');
    expect(chip).toHaveTextContent('[1]Building a Second Brain@ 1:23');
  });

  it('links to the video at the cited timestamp in a new tab', () => {
    render(<CitationChip citation={citation()} index={0} />);
    const chip = screen.getByRole('link');
    expect(chip).toHaveAttribute('href', 'https://youtube.com/watch?v=abc123&t=83s');
    expect(chip).toHaveAttribute('target', '_blank');
    expect(chip).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('renders h:mm:ss past one hour and floors sub-second timestamps', () => {
    render(<CitationChip citation={citation({ startMs: 3_725_900 })} index={2} />);
    const chip = screen.getByRole('link', { name: /\[3\]/ });
    expect(chip).toHaveTextContent('@ 1:02:05');
    expect(chip).toHaveAttribute('href', 'https://youtube.com/watch?v=abc123&t=3725s');
  });
});
