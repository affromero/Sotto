import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip } from '@/components/ui/Chip';

describe('Chip', () => {
  it('renders the label text', () => {
    render(<Chip label="Science" />);
    expect(screen.getByRole('button', { name: 'Science' })).toBeInTheDocument();
  });

  it('has type="button" attribute', () => {
    render(<Chip label="Tag" />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('type', 'button');
  });

  it('calls onClick handler when clicked', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<Chip label="Click Me" onClick={handleClick} />);
    await user.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalled();
  });

  it('does not throw when clicked without onClick handler', async () => {
    const user = userEvent.setup();
    render(<Chip label="No Handler" />);
    await expect(user.click(screen.getByRole('button'))).resolves.not.toThrow();
  });
});
