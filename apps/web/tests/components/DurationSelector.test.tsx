import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DurationSelector } from '@/components/create/DurationSelector';

describe('DurationSelector', () => {
  it('renders all 8 duration options', () => {
    render(<DurationSelector value={10} onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(8);
    expect(screen.getByText('5 min')).toBeInTheDocument();
    expect(screen.getByText('40 min')).toBeInTheDocument();
  });

  it('renders a Duration label', () => {
    render(<DurationSelector value={10} onChange={vi.fn()} />);
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('marks the active button with aria-pressed', () => {
    render(<DurationSelector value={20} onChange={vi.fn()} />);
    const activeButton = screen.getByText('20 min');
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');

    const inactiveButton = screen.getByText('10 min');
    expect(inactiveButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the selected duration when a button is clicked', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<DurationSelector value={10} onChange={handleChange} />);

    await user.click(screen.getByText('30 min'));
    expect(handleChange).toHaveBeenCalledWith(30);
  });

  it('calls onChange for each click without debouncing', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<DurationSelector value={10} onChange={handleChange} />);

    await user.click(screen.getByText('15 min'));
    await user.click(screen.getByText('25 min'));
    expect(handleChange).toHaveBeenCalledTimes(2);
    expect(handleChange).toHaveBeenNthCalledWith(1, 15);
    expect(handleChange).toHaveBeenNthCalledWith(2, 25);
  });

  it('renders options in 5-minute increments from 5 to 40', () => {
    render(<DurationSelector value={10} onChange={vi.fn()} />);
    const expected = [5, 10, 15, 20, 25, 30, 35, 40];
    for (const min of expected) {
      expect(screen.getByText(`${min} min`)).toBeInTheDocument();
    }
  });
});
