import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

const mockUserUpdate = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: {
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
  };
  return { prisma, prismaUnfiltered: prisma };
});

import { GET } from '@/app/api/users/unsubscribe/route';

function signedRequest(userId: string): NextRequest {
  const sig = crypto.createHmac('sha256', 'test-secret').update(userId).digest('hex');
  return new NextRequest(
    `https://selfhost.example.com/api/users/unsubscribe?userId=${userId}&sig=${sig}`
  );
}

describe('GET /api/users/unsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
    mockUserUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders notification settings links for the configured deployment URL', async () => {
    const response = await GET(signedRequest('user-1'));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('https://selfhost.example.com/settings');
    expect(html).not.toContain('https://sotto.fm');
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailNotifications: false },
    });
  });
});
