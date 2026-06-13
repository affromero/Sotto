/**
 * The managed-showcase landing entry points must route into the /welcome demo
 * and never expose sign-in, signup, profile, or app navigation. Sotto is fully
 * self-hosted with no login, so these are purely demoMode checks.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandingCTA } from '@/components/landing/LandingCTA';
import { LandingHeader } from '@/components/landing/LandingHeader';

describe('landing hosted entry points', () => {
  it('routes the hosted primary CTA to the welcome mock', () => {
    render(<LandingCTA withGhost demoMode />);

    const primary = screen.getByRole('link', { name: /try the welcome flow/i });
    expect(primary).toHaveAttribute('href', '/welcome');
    expect(screen.queryByRole('link', { name: /start your course/i })).not.toBeInTheDocument();
  });

  it('routes the hosted header CTA to the welcome mock instead of auth or profile', () => {
    render(<LandingHeader demoMode />);

    const demo = screen.getByRole('link', { name: /try demo/i });
    expect(demo).toHaveAttribute('href', '/welcome');
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  });
});
