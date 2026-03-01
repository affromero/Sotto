import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeTierBanner } from '@/components/ui/FreeTierBanner';

describe('FreeTierBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders nothing for pro users', () => {
    const { container } = render(
      <FreeTierBanner dailyUsed={0} dailyLimit={1} isByokUser={false} isProUser={true} />
    );
    expect(container.firstChild).toBeNull();
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
    expect(screen.getByText(/1 of 1 free podcast.* remaining today/)).toBeInTheDocument();
  });

  it('shows daily limit reached for exhausted free users', () => {
    render(
      <FreeTierBanner dailyUsed={1} dailyLimit={1} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByText(/Daily limit reached/)).toBeInTheDocument();
  });
});
