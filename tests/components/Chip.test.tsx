import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip } from '@/components/ui/Chip';

describe('Chip', () => {
  it('renders the label text', () => {
    render(<Chip label="Science" />);
    expect(screen.getByRole('button', { name: 'Science' })).toBeInTheDocument();
  });

  it('renders as a button element', () => {
    render(<Chip label="Tag" />);
    const chip = screen.getByRole('button');
    expect(chip.tagName).toBe('BUTTON');
  });

  it('has type="button" attribute', () => {
    render(<Chip label="Tag" />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('type', 'button');
  });

  it('does not apply primary or accent class for default variant', () => {
    render(<Chip label="Default" />);
    const chip = screen.getByRole('button');
    // The Chip CSS module has no .default class; default variant is the base chip style
    expect(chip.className).toContain('chip');
    expect(chip.className).not.toContain('primary');
    expect(chip.className).not.toContain('accent');
  });

  it('applies primary variant class', () => {
    render(<Chip label="Primary" variant="primary" />);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('primary');
  });

  it('applies accent variant class', () => {
    render(<Chip label="Accent" variant="accent" />);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('accent');
  });

  it('does not apply selected class when not selected', () => {
    render(<Chip label="Unselected" />);
    const chip = screen.getByRole('button');
    expect(chip.className).not.toContain('selected');
  });

  it('applies selected class when selected', () => {
    render(<Chip label="Selected" selected />);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('selected');
  });

  it('does not apply selected class when selected is false', () => {
    render(<Chip label="Not Selected" selected={false} />);
    const chip = screen.getByRole('button');
    expect(chip.className).not.toContain('selected');
  });

  it('calls onClick handler when clicked', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<Chip label="Click Me" onClick={handleClick} />);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when clicked without onClick handler', async () => {
    const user = userEvent.setup();
    render(<Chip label="No Handler" />);
    await expect(user.click(screen.getByRole('button'))).resolves.not.toThrow();
  });

  it('applies chip base class', () => {
    render(<Chip label="Base" />);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('chip');
  });

  it('combines variant and selected classes correctly', () => {
    render(<Chip label="Combined" variant="primary" selected />);
    const chip = screen.getByRole('button');
    expect(chip.className).toContain('primary');
    expect(chip.className).toContain('selected');
    expect(chip.className).toContain('chip');
  });
});
