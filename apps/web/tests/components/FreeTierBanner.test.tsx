import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeTierBanner } from '@/components/ui/FreeTierBanner';

describe('FreeTierBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders daily limit banner for pro users', () => {
    render(
      <FreeTierBanner dailyUsed={0} dailyLimit={5} isByokUser={false} isProUser={true} />
    );
    expect(screen.getByRole('status', { name: 'Pro status' })).toBeInTheDocument();
    expect(screen.getByText(/5 of 5 podcasts remaining today/)).toBeInTheDocument();
    expect(screen.getByText(/Pro: 5 podcasts per day/)).toBeInTheDocument();
    // Pro users don't see the waitlist button
    expect(screen.queryByText('Join Pro Waitlist')).not.toBeInTheDocument();
  });

  it('shows unlimited banner for BYOK users', () => {
    render(
      <FreeTierBanner dailyUsed={0} dailyLimit={1} isByokUser={true} isProUser={false} />
    );
    expect(screen.getByText('Unlimited generation active')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Pro upgrade suggestion' })).toBeInTheDocument();
  });

  it('shows unlimited banner when dailyLimit is 0 (admin override)', () => {
    render(
      <FreeTierBanner dailyUsed={0} dailyLimit={0} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByText('Unlimited generation active')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Pro upgrade suggestion' })).toBeInTheDocument();
  });

  it('does not show daily-limit-reached for unlimited override users', () => {
    render(
      <FreeTierBanner dailyUsed={0} dailyLimit={0} isByokUser={false} isProUser={false} />
    );
    expect(screen.queryByText(/Daily limit reached/)).not.toBeInTheDocument();
  });

  it('shows remaining count for normal free users', () => {
    render(
      <FreeTierBanner dailyUsed={0} dailyLimit={1} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByRole('status', { name: 'Free tier status' })).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 podcast remaining today/)).toBeInTheDocument();
  });

  it('shows daily limit reached for exhausted free users', () => {
    render(
      <FreeTierBanner dailyUsed={1} dailyLimit={1} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByText(/Daily limit reached/)).toBeInTheDocument();
  });
});
