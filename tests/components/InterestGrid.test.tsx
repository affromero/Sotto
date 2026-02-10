import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterestGrid } from '@/components/discovery/InterestGrid';

vi.mock('@/lib/tag-icons', () => ({
  TagIcon: ({ slug, size, className }: { slug: string; size: number; className?: string }) => (
    <svg
      data-testid={`tag-icon-${slug}`}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <title>{slug} icon</title>
    </svg>
  ),
}));

describe('InterestGrid', () => {
  const mockTags = [
    { id: '1', name: 'Technology', slug: 'technology' },
    { id: '2', name: 'Science', slug: 'science' },
    { id: '3', name: 'Business', slug: 'business' },
  ];

  it('renders all tag buttons with correct names', () => {
    render(<InterestGrid tags={mockTags} />);

    expect(screen.getByRole('button', { name: /Technology/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Science/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Business/i })).toBeInTheDocument();
  });

  it('renders with proper ARIA group label', () => {
    render(<InterestGrid tags={mockTags} />);

    const group = screen.getByRole('group', { name: 'Interest categories' });
    expect(group).toBeInTheDocument();
  });

  it('buttons have aria-pressed=false by default', () => {
    render(<InterestGrid tags={mockTags} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    const scienceButton = screen.getByRole('button', { name: /Science/i });
    const businessButton = screen.getByRole('button', { name: /Business/i });

    expect(techButton).toHaveAttribute('aria-pressed', 'false');
    expect(scienceButton).toHaveAttribute('aria-pressed', 'false');
    expect(businessButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a tag toggles selection (aria-pressed=true)', async () => {
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    expect(techButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(techButton);

    expect(techButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a selected tag deselects it', async () => {
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });

    await user.click(techButton);
    expect(techButton).toHaveAttribute('aria-pressed', 'true');

    await user.click(techButton);
    expect(techButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('onChange callback receives correct tag IDs', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} onChange={handleChange} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    await user.click(techButton);

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith(['1']);
  });

  it('renders with pre-selected tags from selectedTagIds', () => {
    render(<InterestGrid tags={mockTags} selectedTagIds={['1', '3']} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    const scienceButton = screen.getByRole('button', { name: /Science/i });
    const businessButton = screen.getByRole('button', { name: /Business/i });

    expect(techButton).toHaveAttribute('aria-pressed', 'true');
    expect(scienceButton).toHaveAttribute('aria-pressed', 'false');
    expect(businessButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('multiple tags can be selected', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} onChange={handleChange} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    const scienceButton = screen.getByRole('button', { name: /Science/i });

    await user.click(techButton);
    await user.click(scienceButton);

    expect(techButton).toHaveAttribute('aria-pressed', 'true');
    expect(scienceButton).toHaveAttribute('aria-pressed', 'true');
    expect(handleChange).toHaveBeenCalledTimes(2);
    expect(handleChange).toHaveBeenLastCalledWith(['1', '2']);
  });

  it('empty tags array renders empty grid', () => {
    render(<InterestGrid tags={[]} />);

    const group = screen.getByRole('group', { name: 'Interest categories' });
    expect(group).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tags display their names as labels', () => {
    render(<InterestGrid tags={mockTags} />);

    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('Science')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
  });

  it('applies cardSelected class when tag is selected', async () => {
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    expect(techButton.className).not.toContain('cardSelected');

    await user.click(techButton);
    expect(techButton.className).toContain('cardSelected');
  });

  it('shows checkmark when tag is selected', async () => {
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });

    let checkmark = techButton.querySelector('div[aria-hidden="true"]');
    expect(checkmark).toBeNull();

    await user.click(techButton);

    checkmark = screen
      .getByRole('button', { name: /Technology/i })
      .querySelector('div[aria-hidden="true"]');
    expect(checkmark).not.toBeNull();
  });

  it('renders TagIcon for each tag with correct slug', () => {
    render(<InterestGrid tags={mockTags} />);

    expect(screen.getByTestId('tag-icon-technology')).toBeInTheDocument();
    expect(screen.getByTestId('tag-icon-science')).toBeInTheDocument();
    expect(screen.getByTestId('tag-icon-business')).toBeInTheDocument();
  });

  it('TagIcon has correct size of 48', () => {
    render(<InterestGrid tags={mockTags} />);

    const icon = screen.getByTestId('tag-icon-technology');
    expect(icon).toHaveAttribute('width', '48');
    expect(icon).toHaveAttribute('height', '48');
  });

  it('buttons have correct type attribute', () => {
    render(<InterestGrid tags={mockTags} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('type', 'button');
    });
  });

  it('applies animation delay to each button', () => {
    render(<InterestGrid tags={mockTags} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveStyle({ animationDelay: '0ms' });
    expect(buttons[1]).toHaveStyle({ animationDelay: '50ms' });
    expect(buttons[2]).toHaveStyle({ animationDelay: '100ms' });
  });

  it('updates selected state when selectedTagIds prop changes', () => {
    const { rerender } = render(<InterestGrid tags={mockTags} selectedTagIds={['1']} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    const scienceButton = screen.getByRole('button', { name: /Science/i });

    expect(techButton).toHaveAttribute('aria-pressed', 'true');
    expect(scienceButton).toHaveAttribute('aria-pressed', 'false');

    rerender(<InterestGrid tags={mockTags} selectedTagIds={['2']} />);

    expect(techButton).toHaveAttribute('aria-pressed', 'false');
    expect(scienceButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not call onChange when onChange is not provided', async () => {
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    await expect(user.click(techButton)).resolves.not.toThrow();
  });

  it('onChange receives empty array when all tags are deselected', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} selectedTagIds={['1']} onChange={handleChange} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    await user.click(techButton);

    expect(handleChange).toHaveBeenCalledWith([]);
  });

  it('maintains selection order in onChange callback', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid tags={mockTags} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));
    await user.click(screen.getByRole('button', { name: /Business/i }));
    await user.click(screen.getByRole('button', { name: /Science/i }));

    const lastCall = handleChange.mock.calls[handleChange.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(['1', '3', '2']);
  });

  it('renders grid with role group', () => {
    render(<InterestGrid tags={mockTags} />);

    const grid = screen.getByRole('group');
    expect(grid.className).toContain('grid');
  });

  it('applies card class to all buttons', () => {
    render(<InterestGrid tags={mockTags} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button.className).toContain('card');
    });
  });
});
