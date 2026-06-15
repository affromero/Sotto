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

import { AvatarMenu } from '@/components/layout/AvatarMenu';

const owner = { id: 'local-user', name: 'Marco', email: null, image: null, role: 'ADMIN' as const };

const household = {
  profiles: [
    {
      id: 'local-user',
      name: 'Marco',
      avatarUrl: '/avatars/capybara.png',
      isOwner: true,
      role: 'ADMIN',
      courseCount: 1,
      primaryCourse: { targetLang: 'it', level: 'A2' },
      isActive: true,
    },
    {
      id: 'lena',
      name: 'Lena',
      avatarUrl: '/avatars/toucan.png',
      isOwner: false,
      role: 'USER',
      courseCount: 0,
      primaryCourse: null,
      isActive: false,
    },
  ],
};

function mockFetch() {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/v1/profiles/switch')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify(household), { status: 200 });
  });
}

describe('AvatarMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    push.mockClear();
    refresh.mockClear();
  });

  it('shows the owner menu with switch row and admin entry', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<AvatarMenu user={owner} />);

    await user.click(screen.getByRole('button', { name: /open your menu/i }));

    expect(screen.getByText('Your courses')).toBeInTheDocument();
    expect(screen.getByText('Account & appearance')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('Admin console')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /who.s learning/i })).toBeInTheDocument();
    // Switch face for the other profile appears once the household loads.
    expect(await screen.findByRole('button', { name: /switch to lena/i })).toBeInTheDocument();
  });

  it('switches to another profile and routes to /learn', async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<AvatarMenu user={owner} />);

    await user.click(screen.getByRole('button', { name: /open your menu/i }));
    await user.click(await screen.findByRole('button', { name: /switch to lena/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/learn'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/switch',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ profileId: 'lena' }) })
    );
  });

  it('hides the admin entry for a non-owner (USER) profile', async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<AvatarMenu user={{ ...owner, id: 'lena', name: 'Lena', role: 'USER' }} />);

    await user.click(screen.getByRole('button', { name: /open your menu/i }));

    expect(screen.queryByText('Admin console')).not.toBeInTheDocument();
    expect(screen.queryByText('owner')).not.toBeInTheDocument();
  });
});
