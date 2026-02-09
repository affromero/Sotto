import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '@/components/layout/Sidebar';

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
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // Voices, Analytics, Team are CREATOR/ADMIN only
    expect(screen.queryByText('Voices')).not.toBeInTheDocument();
    expect(screen.queryByText('Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
  });

  it('highlights active link for exact path match', () => {
    render(<Sidebar currentPath="/dashboard" />);

    const activeLink = screen.getByText('Dashboard').closest('a');
    expect(activeLink?.className).toContain('navLinkActive');
    expect(activeLink).toHaveAttribute('aria-current', 'page');
  });

  it('highlights active link for nested paths', () => {
    render(<Sidebar currentPath="/settings/voices" />);

    const settingsLink = screen.getByText('Settings').closest('a');
    expect(settingsLink?.className).toContain('navLinkActive');
  });

  it('does not highlight inactive links', () => {
    render(<Sidebar currentPath="/dashboard" />);

    const createLink = screen.getByText('Create').closest('a');
    expect(createLink?.className).not.toContain('navLinkActive');
    expect(createLink).not.toHaveAttribute('aria-current');
  });

  it('has correct href attributes for all links', () => {
    render(<Sidebar currentPath="/dashboard" />);

    expect(screen.getByText('Dashboard').closest('a')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('Create').closest('a')).toHaveAttribute('href', '/create');
    expect(screen.getByText('Feed').closest('a')).toHaveAttribute('href', '/feed');
    expect(screen.getByText('Billing').closest('a')).toHaveAttribute('href', '/billing');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });

  it('shows creator/admin nav items when role is CREATOR', () => {
    const creatorUser = { ...mockUser, role: 'CREATOR' };
    render(<Sidebar currentPath="/dashboard" user={creatorUser} />);

    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Voices')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });

  it('shows admin panel link for ADMIN role', () => {
    const adminUser = { ...mockUser, role: 'ADMIN' };
    render(<Sidebar currentPath="/dashboard" user={adminUser} />);

    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    // ADMIN doesn't see Billing
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
  });

  it('displays user name when provided', () => {
    render(<Sidebar currentPath="/dashboard" user={mockUser} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('displays user email as fallback when no name', () => {
    const userNoName = { ...mockUser, name: null };
    render(<Sidebar currentPath="/dashboard" user={userNoName} />);
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('displays generic User when no user info', () => {
    render(<Sidebar currentPath="/dashboard" />);
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('displays user avatar image when provided', () => {
    render(<Sidebar currentPath="/dashboard" user={mockUser} />);
    const avatar = screen.getByAltText("John Doe's avatar");
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('displays user initials when no avatar image', () => {
    const userNoImage = { ...mockUser, image: null };
    render(<Sidebar currentPath="/dashboard" user={userNoImage} />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    render(<Sidebar currentPath="/dashboard" user={mockUser} />);
    expect(screen.getByLabelText('Sign out')).toBeInTheDocument();
  });

  it('does not apply open styles by default', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toBe('');
  });

  it('applies open styles when isOpen is true', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" isOpen />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('sidebarOpen');
  });

  it('renders overlay when open', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" isOpen />);
    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay?.className).toContain('overlay');
  });

  it('does not render overlay when closed', () => {
    const { container } = render(<Sidebar currentPath="/dashboard" isOpen={false} />);
    const overlay = container.querySelector('div[aria-hidden="true"]');
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
