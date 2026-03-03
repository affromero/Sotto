import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

vi.mock('@/lib/urls', () => ({
  profileUrl: (user: { id: string; handle?: string | null }) =>
    user.handle ? `/@${user.handle}` : `/profile/${user.id}`,
}));

import { Contributors } from '@/components/player/Contributors';

describe('Contributors', () => {
  it('renders nothing when contributors array is empty', () => {
    const { container } = render(<Contributors contributors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders heading and contributor chips with avatars', () => {
    const contributors = [
      {
        contributor: { id: 'u-1', name: 'Alice', handle: 'alice', image: 'https://example.com/alice.jpg' },
        count: 1,
      },
    ];

    render(<Contributors contributors={contributors} />);

    expect(screen.getByText('Contributors')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByAltText('Alice')).toBeInTheDocument();
  });

  it('renders placeholder initials when contributor has no image', () => {
    const contributors = [
      {
        contributor: { id: 'u-2', name: 'Bob', handle: null, image: null },
        count: 1,
      },
    ];

    const { container } = render(<Contributors contributors={contributors} />);

    // Should show "B" as the first letter placeholder
    const placeholder = container.querySelector('[class*="avatarPlaceholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toBe('B');
    // Should show name instead of handle
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders count badge only when count > 1', () => {
    const contributors = [
      {
        contributor: { id: 'u-1', name: 'Alice', handle: 'alice', image: null },
        count: 3,
      },
      {
        contributor: { id: 'u-2', name: 'Bob', handle: null, image: null },
        count: 1,
      },
    ];

    const { container } = render(<Contributors contributors={contributors} />);

    const badges = container.querySelectorAll('[class*="count"]');
    // Only Alice's count badge (3) should appear, not Bob's (1)
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('3');
  });

  it('links to contributor profile', () => {
    const contributors = [
      {
        contributor: { id: 'u-1', name: 'Alice', handle: 'alice', image: null },
        count: 1,
      },
    ];

    render(<Contributors contributors={contributors} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/@alice');
  });

  it('links to profile by id when handle is missing', () => {
    const contributors = [
      {
        contributor: { id: 'u-3', name: 'Carol', handle: null, image: null },
        count: 1,
      },
    ];

    render(<Contributors contributors={contributors} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/profile/u-3');
  });
});
