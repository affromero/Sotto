import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopicCard } from '@/components/discovery/TopicCard';

describe('TopicCard', () => {
  const defaultProps = {
    title: 'Quantum Computing',
    hook: 'Explore the future of computation',
    onClick: vi.fn(),
  };

  it('renders title and hook text', () => {
    render(<TopicCard {...defaultProps} />);
    expect(screen.getByText('Quantum Computing')).toBeInTheDocument();
    expect(screen.getByText('Explore the future of computation')).toBeInTheDocument();
  });

  it('renders category when provided', () => {
    render(<TopicCard {...defaultProps} category="Science" />);
    expect(screen.getByText('Science')).toBeInTheDocument();
  });

  it('does not render category when not provided', () => {
    render(<TopicCard {...defaultProps} />);
    expect(screen.queryByText('Science')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<TopicCard {...defaultProps} onClick={handleClick} />);

    const button = screen.getByRole('button');
    await user.click(button);

    expect(handleClick).toHaveBeenCalled();
  });

  it('has type="button" attribute', () => {
    render(<TopicCard {...defaultProps} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('arrow element has aria-hidden="true"', () => {
    const { container } = render(<TopicCard {...defaultProps} />);
    const arrowElement = container.querySelector('[aria-hidden="true"]');
    expect(arrowElement).toBeInTheDocument();
  });
});
