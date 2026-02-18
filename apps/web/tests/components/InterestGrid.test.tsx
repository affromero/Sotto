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
  const mockCategories = [
    {
      id: 'cat-1',
      name: 'Technology',
      slug: 'technology',
      children: [
        { id: 'sub-1', name: 'Quantum Computing', slug: 'quantum-computing' },
        { id: 'sub-2', name: 'Cybersecurity', slug: 'cybersecurity' },
        { id: 'sub-3', name: 'Robotics', slug: 'robotics' },
      ],
    },
    {
      id: 'cat-2',
      name: 'Science',
      slug: 'science',
      children: [
        { id: 'sub-4', name: 'Neuroscience', slug: 'neuroscience' },
        { id: 'sub-5', name: 'Genetics', slug: 'genetics' },
      ],
    },
    {
      id: 'cat-3',
      name: 'Business',
      slug: 'business',
      children: [
        { id: 'sub-6', name: 'Startups', slug: 'startups' },
      ],
    },
  ];

  it('renders all category cards with correct names', () => {
    render(<InterestGrid categories={mockCategories} />);

    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('Science')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
  });

  it('renders with proper ARIA group label', () => {
    render(<InterestGrid categories={mockCategories} />);

    const group = screen.getByRole('group', { name: 'Interest categories' });
    expect(group).toBeInTheDocument();
  });

  it('category cards have aria-expanded=false by default', () => {
    render(<InterestGrid categories={mockCategories} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    expect(techButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking a category expands it to show sub-interests', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    await user.click(techButton);

    expect(techButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Quantum Computing')).toBeInTheDocument();
    expect(screen.getByText('Cybersecurity')).toBeInTheDocument();
    expect(screen.getByText('Robotics')).toBeInTheDocument();
  });

  it('clicking an expanded category collapses it', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    await user.click(techButton);
    expect(techButton).toHaveAttribute('aria-expanded', 'true');

    await user.click(techButton);
    expect(techButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('accordion: expanding one category collapses the previous', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} />);

    const techButton = screen.getByRole('button', { name: /Technology/i });
    const scienceButton = screen.getByRole('button', { name: /Science/i });

    await user.click(techButton);
    expect(techButton).toHaveAttribute('aria-expanded', 'true');

    await user.click(scienceButton);
    expect(scienceButton).toHaveAttribute('aria-expanded', 'true');
    expect(techButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('selecting a sub-interest chip calls onChange with its ID', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const chip = screen.getByRole('button', { name: /Quantum Computing/i });
    await user.click(chip);

    expect(handleChange).toHaveBeenCalledWith(['sub-1'], []);
  });

  it('deselecting a chip removes it from onChange', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} selectedTagIds={['sub-1']} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const chip = screen.getByRole('button', { name: /Quantum Computing/i });
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    await user.click(chip);
    expect(handleChange).toHaveBeenCalledWith([], []);
  });

  it('shows count badge when sub-interests are selected in a category', () => {
    render(<InterestGrid categories={mockCategories} selectedTagIds={['sub-1', 'sub-2']} />);

    expect(screen.getByLabelText('2 selected')).toBeInTheDocument();
  });

  it('Select All button selects all children in the expanded category', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));
    await user.click(screen.getByText('Select All'));

    expect(handleChange).toHaveBeenCalledWith(['sub-1', 'sub-2', 'sub-3'], []);
  });

  it('Clear button deselects all children in the expanded category', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} selectedTagIds={['sub-1', 'sub-2', 'sub-3']} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));
    await user.click(screen.getByText('Clear'));

    expect(handleChange).toHaveBeenCalledWith([], []);
  });

  it('empty categories array renders empty grid', () => {
    render(<InterestGrid categories={[]} />);

    const group = screen.getByRole('group', { name: 'Interest categories' });
    expect(group).toBeInTheDocument();
  });

  it('renders with pre-selected sub-interest IDs', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} selectedTagIds={['sub-4']} />);

    // Science should show badge
    expect(screen.getByLabelText('1 selected')).toBeInTheDocument();

    // Expand Science to verify chip is selected
    await user.click(screen.getByRole('button', { name: /Science/i }));
    const chip = screen.getByRole('button', { name: /Neuroscience/i });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('updates selection when selectedTagIds prop changes', () => {
    const { rerender } = render(
      <InterestGrid categories={mockCategories} selectedTagIds={['sub-1']} />
    );

    expect(screen.getByLabelText('1 selected')).toBeInTheDocument();

    rerender(<InterestGrid categories={mockCategories} selectedTagIds={['sub-4', 'sub-5']} />);

    // Technology badge should be gone, Science badge should show 2
    expect(screen.getByLabelText('2 selected')).toBeInTheDocument();
  });

  // ---- "Other" custom sub-interest tests ----

  it('renders "Other" input inside expanded category panel', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Other...');
  });

  it('typing and clicking add creates a custom tag chip', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'Quantum Biology');
    await user.click(screen.getByLabelText('Add custom interest'));

    // Custom chip should appear
    expect(screen.getByText('Quantum Biology')).toBeInTheDocument();
    // onChange should include custom tag
    expect(handleChange).toHaveBeenLastCalledWith([], [{ name: 'Quantum Biology', parentSlug: 'technology' }]);
  });

  it('pressing Enter in the input adds a custom tag', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'Indie Hacking{Enter}');

    expect(screen.getByText('Indie Hacking')).toBeInTheDocument();
    expect(handleChange).toHaveBeenLastCalledWith([], [{ name: 'Indie Hacking', parentSlug: 'technology' }]);
  });

  it('clears the input field after adding a custom tag', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'Bioinformatics{Enter}');

    expect(input).toHaveValue('');
  });

  it('clicking a custom tag chip removes it', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'Quantum Biology{Enter}');

    const removeButton = screen.getByLabelText('Remove Quantum Biology');
    await user.click(removeButton);

    expect(screen.queryByText('Quantum Biology')).not.toBeInTheDocument();
    expect(handleChange).toHaveBeenLastCalledWith([], []);
  });

  it('prevents duplicate custom tags within the same category', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'AI Ethics{Enter}');
    await user.type(input, 'ai ethics{Enter}');

    // Should only have one chip
    const chips = screen.getAllByText(/AI Ethics/i);
    expect(chips).toHaveLength(1);
  });

  it('rejects custom tag names shorter than 2 characters', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} onChange={handleChange} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'A{Enter}');

    // onChange should not have been called with custom tags
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('includes custom tags in badge count', async () => {
    const user = userEvent.setup();
    render(<InterestGrid categories={mockCategories} selectedTagIds={['sub-1']} />);

    await user.click(screen.getByRole('button', { name: /Technology/i }));

    const input = screen.getByLabelText('Add custom Technology interest');
    await user.type(input, 'Quantum Biology{Enter}');

    // Badge should show 2 (1 predefined + 1 custom)
    expect(screen.getByLabelText('2 selected')).toBeInTheDocument();
  });

  it('Clear button also removes custom tags for that category', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();
    render(
      <InterestGrid
        categories={mockCategories}
        selectedTagIds={['sub-1', 'sub-2', 'sub-3']}
        customTags={[{ name: 'Custom Tag', parentSlug: 'technology' }]}
        onChange={handleChange}
      />
    );

    await user.click(screen.getByRole('button', { name: /Technology/i }));
    await user.click(screen.getByText('Clear'));

    expect(handleChange).toHaveBeenLastCalledWith([], []);
  });
});
