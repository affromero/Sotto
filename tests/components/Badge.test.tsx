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

  it('renders as a span element', () => {
    render(<Badge>Status</Badge>);
    const badge = screen.getByText('Status');
    expect(badge.tagName).toBe('SPAN');
  });

  it('applies badge base class', () => {
    render(<Badge>Base</Badge>);
    const badge = screen.getByText('Base');
    expect(badge.className).toContain('badge');
  });

  it('applies default variant class by default', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge.className).toContain('default');
  });

  it('applies success variant class', () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge.className).toContain('success');
  });

  it('applies warning variant class', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('warning');
  });

  it('applies error variant class', () => {
    render(<Badge variant="error">Error</Badge>);
    const badge = screen.getByText('Error');
    expect(badge.className).toContain('error');
  });

  it('applies info variant class', () => {
    render(<Badge variant="info">Info</Badge>);
    const badge = screen.getByText('Info');
    expect(badge.className).toContain('info');
  });

  it('applies soon variant class', () => {
    render(<Badge variant="soon">SOON</Badge>);
    const badge = screen.getByText('SOON');
    expect(badge.className).toContain('soon');
  });

  it('combines badge and variant classes', () => {
    render(<Badge variant="error">Critical</Badge>);
    const badge = screen.getByText('Critical');
    expect(badge.className).toContain('badge');
    expect(badge.className).toContain('error');
  });
});
