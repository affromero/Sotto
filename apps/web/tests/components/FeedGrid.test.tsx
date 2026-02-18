import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedGrid } from '@/components/feed/FeedGrid';

describe('FeedGrid', () => {
  it('renders children in grid layout', () => {
    render(
      <FeedGrid>
        <div data-testid="card-1">Card 1</div>
        <div data-testid="card-2">Card 2</div>
        <div data-testid="card-3">Card 3</div>
      </FeedGrid>
    );

    expect(screen.getByTestId('card-1')).toBeInTheDocument();
    expect(screen.getByTestId('card-2')).toBeInTheDocument();
    expect(screen.getByTestId('card-3')).toBeInTheDocument();
  });

  it('displays loading state with skeleton cards', () => {
    render(<FeedGrid loading>Content</FeedGrid>);

    expect(screen.getByRole('status', { name: 'Loading podcasts' })).toBeInTheDocument();
    expect(screen.getByText('Loading podcasts...')).toBeInTheDocument();
  });

  it('renders 6 skeleton cards when loading', () => {
    const { container } = render(<FeedGrid loading>Content</FeedGrid>);

    const grid = container.querySelector('[role="status"]');
    const skeletons = grid?.querySelectorAll('[aria-hidden="true"]');
    expect(skeletons?.length).toBeGreaterThan(0);
  });

  it('does not render children when loading', () => {
    render(
      <FeedGrid loading>
        <div data-testid="hidden-card">Should not appear</div>
      </FeedGrid>
    );

    expect(screen.queryByTestId('hidden-card')).not.toBeInTheDocument();
  });

  it('displays empty state when no children', () => {
    render(<FeedGrid>{undefined}</FeedGrid>);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No podcasts found')).toBeInTheDocument();
  });

  it('displays custom empty message', () => {
    render(<FeedGrid emptyMessage="Nothing here yet">{undefined}</FeedGrid>);

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('shows empty state for empty array children', () => {
    render(<FeedGrid>{[]}</FeedGrid>);

    expect(screen.getByText('No podcasts found')).toBeInTheDocument();
  });

  it('shows empty state for array with only null/undefined children', () => {
    render(
      <FeedGrid>
        {[null, undefined, false].map((item, i) => item && <div key={i}>Item</div>)}
      </FeedGrid>
    );

    expect(screen.getByText('No podcasts found')).toBeInTheDocument();
  });

  it('renders content when children exist', () => {
    render(
      <FeedGrid>
        <div data-testid="content">Actual content</div>
      </FeedGrid>
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByText('No podcasts found')).not.toBeInTheDocument();
  });

  it('does not show loading or empty state when has children', () => {
    render(
      <FeedGrid loading={false}>
        <div data-testid="card">Card</div>
      </FeedGrid>
    );

    expect(screen.queryByText('Loading podcasts...')).not.toBeInTheDocument();
    expect(screen.queryByText('No podcasts found')).not.toBeInTheDocument();
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });

  it('loading state overrides children', () => {
    render(
      <FeedGrid loading>
        <div data-testid="should-be-hidden">Content</div>
      </FeedGrid>
    );

    expect(screen.queryByTestId('should-be-hidden')).not.toBeInTheDocument();
    expect(screen.getByText('Loading podcasts...')).toBeInTheDocument();
  });

  it('applies proper ARIA attributes to loading state', () => {
    render(<FeedGrid loading>{undefined}</FeedGrid>);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading podcasts');
  });

});
