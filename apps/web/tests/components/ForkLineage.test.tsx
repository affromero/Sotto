import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; width: number; height: number; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

import { ForkLineage } from '@/components/player/ForkLineage';

const makeUser = (id: string, name: string) => ({
  id,
  name,
  handle: null,
  image: null,
});

describe('ForkLineage', () => {
  it('renders nothing when both arrays are empty', () => {
    const { container } = render(<ForkLineage ancestors={[]} forks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ancestors as breadcrumb with Current Podcast at end', () => {
    const ancestors = [
      { id: 'anc-1', title: 'Original Episode', user: makeUser('u-1', 'Alice') },
      { id: 'anc-2', title: 'First Fork', user: makeUser('u-2', 'Bob') },
    ];

    render(<ForkLineage ancestors={ancestors} forks={[]} />);

    expect(screen.getByText('Lineage')).toBeInTheDocument();
    expect(screen.getByText('Original Episode')).toBeInTheDocument();
    expect(screen.getByText('First Fork')).toBeInTheDocument();
    expect(screen.getByText('Current Podcast')).toBeInTheDocument();

    // Links point to podcast pages
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/podcast/anc-1');
    expect(links[1]).toHaveAttribute('href', '/podcast/anc-2');
  });

  it('renders regular forks without Re-voice badge', () => {
    const forks = [
      {
        id: 'fork-1',
        title: 'Regular Fork',
        remixNote: null,
        createdAt: new Date().toISOString(),
        isVoiceOnlyFork: false,
        user: makeUser('u-3', 'Carol'),
      },
    ];

    const { container } = render(<ForkLineage ancestors={[]} forks={forks} />);

    expect(screen.getByText('Regular Fork')).toBeInTheDocument();
    // Should NOT have voice badge
    const voiceBadge = container.querySelector('[class*="voiceBadge"]');
    expect(voiceBadge).toBeNull();
  });

  it('renders voice-only forks with Re-voice badge and voiceForkItem class', () => {
    const forks = [
      {
        id: 'fork-2',
        title: 'Voice Rendition',
        remixNote: null,
        createdAt: new Date().toISOString(),
        isVoiceOnlyFork: true,
        user: makeUser('u-4', 'Dave'),
      },
    ];

    const { container } = render(<ForkLineage ancestors={[]} forks={forks} />);

    expect(screen.getByText('Voice Rendition')).toBeInTheDocument();
    expect(screen.getByText('Re-voice')).toBeInTheDocument();

    // Should have the voiceForkItem CSS class
    const voiceItem = container.querySelector('[class*="voiceForkItem"]');
    expect(voiceItem).not.toBeNull();
  });

  it('renders remixNote when present', () => {
    const forks = [
      {
        id: 'fork-3',
        title: 'Custom Fork',
        remixNote: 'Added British accent',
        createdAt: new Date().toISOString(),
        user: makeUser('u-5', 'Eve'),
      },
    ];

    render(<ForkLineage ancestors={[]} forks={forks} />);

    expect(screen.getByText('Added British accent')).toBeInTheDocument();
  });

  it('shows only 5 forks by default and reveals rest on button click', async () => {
    const user = userEvent.setup();
    const forks = Array.from({ length: 8 }, (_, i) => ({
      id: `fork-${i}`,
      title: `Fork ${i}`,
      remixNote: null,
      createdAt: new Date().toISOString(),
      user: makeUser(`u-${i}`, `User ${i}`),
    }));

    render(<ForkLineage ancestors={[]} forks={forks} />);

    // Only 5 visible initially
    expect(screen.getByText('Fork 0')).toBeInTheDocument();
    expect(screen.getByText('Fork 4')).toBeInTheDocument();
    expect(screen.queryByText('Fork 5')).not.toBeInTheDocument();

    // Show more button
    const showMoreBtn = screen.getByRole('button', { name: 'Show 3 more forks' });
    expect(showMoreBtn).toBeInTheDocument();

    await user.click(showMoreBtn);

    // All visible after click
    expect(screen.getByText('Fork 5')).toBeInTheDocument();
    expect(screen.getByText('Fork 7')).toBeInTheDocument();
    // Button should be gone
    expect(screen.queryByRole('button', { name: 'Show 3 more forks' })).not.toBeInTheDocument();
  });

  it('displays fork count in section header', () => {
    const forks = [
      {
        id: 'fork-1',
        title: 'Only Fork',
        remixNote: null,
        createdAt: new Date().toISOString(),
        user: makeUser('u-1', 'Alice'),
      },
    ];

    render(<ForkLineage ancestors={[]} forks={forks} />);

    expect(screen.getByText('(1)')).toBeInTheDocument();
  });
});
