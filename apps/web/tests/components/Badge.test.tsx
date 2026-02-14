import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/Badge';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders children as JSX', () => {
    render(
      <Badge>
        <span data-testid="inner">Content</span>
      </Badge>
    );
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });
});
