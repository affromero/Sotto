import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from '@/components/ui/Spinner';

describe('Spinner', () => {
  it('has role="status" for accessibility', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('[role="status"]');
    expect(spinner).toBeInTheDocument();
  });

  it('has aria-label="Loading" for accessibility', () => {
    const { container } = render(<Spinner />);
    const spinner = container.querySelector('[aria-label="Loading"]');
    expect(spinner).toBeInTheDocument();
  });
});
