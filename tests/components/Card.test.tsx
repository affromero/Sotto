import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card } from '@/components/ui/Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders children as JSX', () => {
    render(
      <Card>
        <h2>Title</h2>
        <p>Description</p>
      </Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('applies default variant class', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('default');
  });

  it('applies elevated variant class', () => {
    const { container } = render(<Card variant="elevated">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('elevated');
  });

  it('applies outlined variant class', () => {
    const { container } = render(<Card variant="outlined">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('outlined');
  });

  it('renders as div when not clickable', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.tagName).toBe('DIV');
  });

  it('renders as button when onClick is provided', () => {
    const handleClick = vi.fn();
    render(<Card onClick={handleClick}>Clickable</Card>);
    const card = screen.getByRole('button');
    expect(card.tagName).toBe('BUTTON');
  });

  it('applies clickable class when onClick is provided', () => {
    const handleClick = vi.fn();
    render(<Card onClick={handleClick}>Clickable</Card>);
    const card = screen.getByRole('button');
    expect(card.className).toContain('clickable');
  });

  it('does not apply clickable class when not clickable', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain('clickable');
  });

  it('fires onClick handler when clicked', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<Card onClick={handleClick}>Clickable</Card>);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="my-card">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('my-card');
  });

  it('applies card base class', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('card');
  });

  it('applies padding class for medium padding (default)', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('padmedium');
  });

  it('applies padding class for none', () => {
    const { container } = render(<Card padding="none">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('padnone');
  });

  it('applies padding class for small', () => {
    const { container } = render(<Card padding="small">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('padsmall');
  });

  it('applies padding class for large', () => {
    const { container } = render(<Card padding="large">Content</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('padlarge');
  });
});
