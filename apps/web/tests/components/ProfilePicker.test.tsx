import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement('img', { src, alt }),
}));

import { ProfilePicker } from '@/components/profiles/ProfilePicker';
import type { HouseholdProfile } from '@/lib/profiles';

const owner: HouseholdProfile = {
  id: 'local-user',
  name: 'Marco',
  avatarUrl: '/avatars/capybara.png',
  isOwner: true,
  role: 'ADMIN',
  courseCount: 1,
  primaryCourse: { targetLang: 'it', level: 'A2' },
};

const member: HouseholdProfile = {
  id: 'lena',
  name: 'Lena',
  avatarUrl: '/avatars/toucan.png',
  isOwner: false,
  role: 'USER',
  courseCount: 0,
  primaryCourse: null,
};

describe('ProfilePicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    push.mockClear();
    refresh.mockClear();
  });

  it('renders every profile with its course summary plus an add tile', () => {
    render(<ProfilePicker profiles={[owner, member]} activeId="local-user" />);

    expect(screen.getByText('Marco')).toBeInTheDocument();
    expect(screen.getByText('Italian · A2')).toBeInTheDocument();
    expect(screen.getByText('Lena')).toBeInTheDocument();
    expect(screen.getByText('New learner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to marco/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add learner/i })).toBeInTheDocument();
  });

  it('switches profile and navigates to /learn on pick', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const user = userEvent.setup();

    render(<ProfilePicker profiles={[owner, member]} activeId="local-user" />);
    await user.click(screen.getByRole('button', { name: /switch to lena/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/switch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ profileId: 'lena' }) })
    );
  });

  it('opens the editor for a profile in manage mode instead of switching', async () => {
    const user = userEvent.setup();
    render(<ProfilePicker profiles={[owner, member]} activeId="local-user" />);

    await user.click(screen.getByRole('button', { name: /manage profiles/i }));
    await user.click(screen.getByRole('button', { name: /edit lena/i }));

    expect(screen.getByRole('dialog', { name: /edit profile/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Lena');
    // A non-owner that isn't the last profile can be deleted.
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('creates a new learner then switches to it', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const user = userEvent.setup();

    render(<ProfilePicker profiles={[owner]} activeId="local-user" />);
    await user.click(screen.getByRole('button', { name: /add learner/i }));
    await user.type(screen.getByLabelText('Name'), 'Sofía');
    await user.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn'));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/profiles',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
