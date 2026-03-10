import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeTierCounter } from '@/components/ui/FreeTierCounter';

describe('FreeTierCounter', () => {
  it('renders nothing for BYOK users', () => {
    const { container } = render(
      <FreeTierCounter dailyUsed={0} dailyLimit={1} isByokUser={true} isProUser={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Pro pill with daily usage for pro users', () => {
    render(
      <FreeTierCounter dailyUsed={2} dailyLimit={5} isByokUser={false} isProUser={true} />
    );
    expect(screen.getByText('Pro 2/5')).toBeInTheDocument();
    expect(screen.getByLabelText('Pro: 2 of 5 podcasts used today')).toBeInTheDocument();
  });

  it('renders Unlimited pill when dailyLimit is 0 (admin override)', () => {
    render(
      <FreeTierCounter dailyUsed={0} dailyLimit={0} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByText('Unlimited')).toBeInTheDocument();
    expect(screen.getByLabelText('Unlimited generation')).toBeInTheDocument();
  });

  it('renders daily usage counter for normal free users', () => {
    render(
      <FreeTierCounter dailyUsed={0} dailyLimit={3} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByText('0/3 today')).toBeInTheDocument();
  });

  it('shows exhausted state when daily limit reached', () => {
    render(
      <FreeTierCounter dailyUsed={1} dailyLimit={1} isByokUser={false} isProUser={false} />
    );
    expect(screen.getByText('1/1 today')).toBeInTheDocument();
    expect(screen.getByLabelText('1 of 1 free podcasts used today')).toBeInTheDocument();
  });
});
