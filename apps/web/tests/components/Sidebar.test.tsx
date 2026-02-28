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
    render(<Sidebar currentPath="/dashboard" />);
    expect(screen.getByText('Sotto')).toBeInTheDocument();
  });

  it('renders all navigation links for default USER role', () => {
    render(<Sidebar currentPath="/dashboard" />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Discover')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // Voices, Analytics, Team are CREATOR/ADMIN only
    expect(screen.queryByText('Voices')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
  });

  it('marks active link with aria-current for exact path match', () => {
    render(<Sidebar currentPath="/dashboard" />);

    const activeLink = screen.getByText('Dashboard').closest('a');
    expect(activeLink).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark inactive links with aria-current', () => {
    render(<Sidebar currentPath="/dashboard" />);

    const createLink = screen.getByText('Create').closest('a');
    expect(createLink).not.toHaveAttribute('aria-current');
  });

  it('has correct href attributes for all links', () => {
    render(<Sidebar currentPath="/dashboard" />);

    expect(screen.getByText('Dashboard').closest('a')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('Create').closest('a')).toHaveAttribute('href', '/create');
    expect(screen.getByText('Discover').closest('a')).toHaveAttribute('href', '/feed');
    expect(screen.getByText('API Keys').closest('a')).toHaveAttribute('href', '/billing');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  it('shows creator/admin nav items when role is CREATOR', () => {
    const creatorUser = { ...mockUser, role: 'CREATOR' };
    render(<Sidebar currentPath="/dashboard" user={creatorUser} hasPodcasts />);

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Voices')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });

  it('shows admin panel link for ADMIN role', () => {
    const adminUser = { ...mockUser, role: 'ADMIN' };
    render(<Sidebar currentPath="/dashboard" user={adminUser} hasPodcasts />);

    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('API Keys')).toBeInTheDocument();
  });

  it('renders AccountSwitcher with dashboard variant', () => {
    render(<Sidebar currentPath="/dashboard" />);
    const switcher = screen.getByTestId('account-switcher');
    expect(switcher).toBeInTheDocument();
    expect(switcher).toHaveAttribute('data-variant', 'dashboard');
  });

  it('renders overlay when open', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" isOpen />);
    const overlay = container.querySelector('[class*="overlay"]');
    expect(overlay).toBeInTheDocument();
  });

  it('does not render overlay when closed', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" isOpen={false} />);
    const overlay = container.querySelector('[class*="overlay"]');
    expect(overlay).not.toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Sidebar currentPath="/dashboard" isOpen onClose={handleClose} />);

    const overlay = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    await user.click(overlay);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when nav link is clicked', async () => {
    const handleClose = vi.fn();
    const user = userEvent.setup();
    render(<Sidebar currentPath="/dashboard" isOpen onClose={handleClose} />);

    const createLink = screen.getByText('Create').closest('a');
    if (createLink) await user.click(createLink);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('has proper ARIA navigation labels', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" />);

    expect(screen.getByLabelText('Main navigation')).toBeInTheDocument();
    const nav = container.querySelector('nav[aria-label="Dashboard navigation"]');
    expect(nav).toBeInTheDocument();
  });

  it('logo links to home page', () => {
    render(<Sidebar currentPath="/dashboard" />);
    const logo = screen.getByText('Sotto').closest('a');
    expect(logo).toHaveAttribute('href', '/');
  });
});
