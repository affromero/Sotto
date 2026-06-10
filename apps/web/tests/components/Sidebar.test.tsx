import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '@/components/layout/Sidebar';

vi.mock('@/components/layout/AccountSwitcher', () => ({
  AccountSwitcher: ({ variant }: { variant: string }) => (
    <div data-testid="account-switcher" data-variant={variant} />
  ),
}));

vi.mock('@/components/notifications/NotificationDropdown', () => ({
  NotificationDropdown: () => <div data-testid="notification-dropdown" />,
}));

const mockUser = {
  name: 'John Doe',
  email: 'john@example.com',
  image: 'https://example.com/avatar.jpg',
};

describe('Sidebar', () => {
  it('renders Sotto logo', () => {
    render(<Sidebar currentPath="/learn" />);
    expect(screen.getByText('Sotto')).toBeInTheDocument();
  });

  it('renders the language-focused navigation for a default USER', () => {
    render(<Sidebar currentPath="/learn" />);

    expect(screen.getByText('Learn')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // Analytics is admin-only; the old podcast surfaces are gone.
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Create')).not.toBeInTheDocument();
    expect(screen.queryByText('Voices')).not.toBeInTheDocument();
    expect(screen.queryByText('Library')).not.toBeInTheDocument();
  });

  it('marks active link with aria-current for exact path match', () => {
    render(<Sidebar currentPath="/learn" />);
    expect(screen.getByText('Learn').closest('a')).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark inactive links with aria-current', () => {
    render(<Sidebar currentPath="/learn" />);
    expect(screen.getByText('Memory').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('has correct href attributes for all links', () => {
    render(<Sidebar currentPath="/learn" />);
    expect(screen.getByText('Learn').closest('a')).toHaveAttribute('href', '/learn');
    expect(screen.getByText('Memory').closest('a')).toHaveAttribute('href', '/memory');
    expect(screen.getByText('API Keys').closest('a')).toHaveAttribute('href', '/billing');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  it('shows Analytics and the admin panel only for ADMIN', () => {
    const adminUser = { ...mockUser, role: 'ADMIN' };
    render(<Sidebar currentPath="/learn" user={adminUser} />);

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
  });

  it('hides the admin panel for a non-admin user', () => {
    render(<Sidebar currentPath="/learn" user={mockUser} />);
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });

  it('renders AccountSwitcher with dashboard variant', () => {
    render(<Sidebar currentPath="/learn" />);
    const switcher = screen.getByTestId('account-switcher');
    expect(switcher).toBeInTheDocument();
    expect(switcher).toHaveAttribute('data-variant', 'dashboard');
  });

  it('renders overlay when open', () => {
    const { container } = render(<Sidebar currentPath="/learn" isOpen />);
    expect(container.querySelector('[class*="overlay"]')).toBeInTheDocument();
  });

  it('overlay is hidden when closed', () => {
    const { container } = render(<Sidebar currentPath="/learn" isOpen={false} />);
    const overlay = container.querySelector('[class*="overlay"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveStyle({ pointerEvents: 'none' });
  });

  it('calls onClose when overlay is clicked', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Sidebar currentPath="/learn" isOpen onClose={handleClose} />);

    const overlay = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    await user.click(overlay);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when a nav link is clicked', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar currentPath="/learn" isOpen onClose={handleClose} />);

    const learnLink = screen.getByText('Learn').closest('a');
    if (learnLink) await user.click(learnLink);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('has proper ARIA navigation labels', () => {
    const { container } = render(<Sidebar currentPath="/learn" />);
    expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
    expect(container.querySelector('nav[aria-label="Dashboard navigation"]')).toBeInTheDocument();
  });

  it('logo links to home page', () => {
    render(<Sidebar currentPath="/learn" />);
    expect(screen.getByText('Sotto').closest('a')).toHaveAttribute('href', '/');
  });
});
