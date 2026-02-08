import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders children text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('renders children as JSX', () => {
    render(
      <Button>
        <span data-testid="inner">Content</span>
      </Button>
    );
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });

  it('applies primary variant class by default', () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('primary');
  });

  it('applies secondary variant class', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('secondary');
  });

  it('applies ghost variant class', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('ghost');
  });

  it('applies danger variant class', () => {
    render(<Button variant="danger">Danger</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('danger');
  });

  it('applies medium size class by default', () => {
    render(<Button>Medium</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('medium');
  });

  it('applies small size class', () => {
    render(<Button size="small">Small</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('small');
  });

  it('applies large size class', () => {
    render(<Button size="large">Large</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('large');
  });

  it('shows spinner element when loading', () => {
    render(<Button loading>Loading</Button>);
    const button = screen.getByRole('button');
    // The spinner is a <span> child rendered only when loading is true
    const spans = button.querySelectorAll('span');
    expect(spans.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show spinner when not loading', () => {
    render(<Button>Not Loading</Button>);
    const button = screen.getByRole('button');
    // No extra span elements should be present when not loading
    const spans = button.querySelectorAll('span');
    expect(spans.length).toBe(0);
  });

  it('is disabled when loading', () => {
    render(<Button loading>Loading</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('is disabled when both loading and disabled are true', () => {
    render(
      <Button loading disabled>
        Both
      </Button>
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('is not disabled by default', () => {
    render(<Button>Enabled</Button>);
    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
  });

  it('handles click events', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={handleClick}>Click me</Button>);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire click when disabled', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={handleClick} disabled>
        Click me
      </Button>
    );
    await user.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('does not fire click when loading', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={handleClick} loading>
        Click me
      </Button>
    );
    await user.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies fullWidth class when fullWidth is true', () => {
    render(<Button fullWidth>Full Width</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('fullWidth');
  });

  it('does not apply fullWidth class by default', () => {
    render(<Button>Normal</Button>);
    const button = screen.getByRole('button');
    expect(button.className).not.toContain('fullWidth');
  });

  it('applies custom className', () => {
    render(<Button className="custom-class">Custom</Button>);
    const button = screen.getByRole('button');
    expect(button.className).toContain('custom-class');
  });

  it('passes through additional HTML button attributes', () => {
    render(
      <Button type="submit" aria-label="Submit form">
        Submit
      </Button>
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveAttribute('aria-label', 'Submit form');
  });
});
