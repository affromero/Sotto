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
    const { container } = render(<TopicCard {...defaultProps} />);
    const categoryElements = container.querySelectorAll('[class*="category"]');
    expect(categoryElements.length).toBe(0);
  });

  it('calls onClick when clicked', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(<TopicCard {...defaultProps} onClick={handleClick} />);

    const button = screen.getByRole('button');
    await user.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('applies compact class when variant is compact', () => {
    render(<TopicCard {...defaultProps} variant="compact" />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('compact');
  });

  it('does not apply compact class by default', () => {
    render(<TopicCard {...defaultProps} />);
    const button = screen.getByRole('button');
    expect(button.className).not.toContain('compact');
  });

  it('does not apply compact class when variant is default', () => {
    render(<TopicCard {...defaultProps} variant="default" />);
    const button = screen.getByRole('button');
    expect(button.className).not.toContain('compact');
  });

  it('has type="button" attribute', () => {
    render(<TopicCard {...defaultProps} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('arrow element has aria-hidden="true"', () => {
    const { container } = render(<TopicCard {...defaultProps} />);
    const arrowElement = container.querySelector('[class*="arrow"]');
    expect(arrowElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders all content sections', () => {
    const { container } = render(<TopicCard {...defaultProps} category="Technology" />);

    const contentDiv = container.querySelector('[class*="content"]');
    expect(contentDiv).toBeInTheDocument();

    const titleSpan = container.querySelector('[class*="title"]');
    expect(titleSpan).toBeInTheDocument();
    expect(titleSpan?.textContent).toBe('Quantum Computing');

    const hookSpan = container.querySelector('[class*="hook"]');
    expect(hookSpan).toBeInTheDocument();
    expect(hookSpan?.textContent).toBe('Explore the future of computation');

    const categorySpan = container.querySelector('[class*="category"]');
    expect(categorySpan).toBeInTheDocument();
    expect(categorySpan?.textContent).toBe('Technology');
  });

  it('renders SVG arrow icon', () => {
    const { container } = render(<TopicCard {...defaultProps} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
  });

  it('applies card class to button', () => {
    render(<TopicCard {...defaultProps} />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('card');
  });
});
