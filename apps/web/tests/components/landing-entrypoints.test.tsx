/**
 * Hosted landing entry points must stay in the public welcome mock. They should
 * not expose sign-in, signup, profile, or app navigation even if the browser has
 * an old authenticated session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandingCTA } from '@/components/landing/LandingCTA';
import { LandingHeader } from '@/components/landing/LandingHeader';

const mockUseAuth = vi.fn();

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/hooks/useHasMounted', () => ({
  useHasMounted: () => true,
}));

describe('landing hosted entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
  });

  it('routes the hosted primary CTA to the welcome mock', () => {
    render(<LandingCTA withGhost demoMode />);

    const primary = screen.getByRole('link', { name: /try the welcome flow/i });
    expect(primary).toHaveAttribute('href', '/welcome');
    expect(screen.queryByRole('link', { name: /start your course/i })).not.toBeInTheDocument();
  });

  it('routes the hosted header CTA to the welcome mock instead of auth or profile', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });

    render(<LandingHeader demoMode />);

    const demo = screen.getByRole('link', { name: /try demo/i });
    expect(demo).toHaveAttribute('href', '/welcome');
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });
});
