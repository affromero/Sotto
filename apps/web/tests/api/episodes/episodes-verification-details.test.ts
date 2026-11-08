import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  episode: vi.fn(),
  script: vi.fn(),
  discovery: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { id: 'learner' } }) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    episode: { findUnique: boundary.episode },
    script: { findUnique: boundary.script },
    discovery: { findUnique: boundary.discovery },
  },
}));

import { GET } from '@/app/api/v1/episodes/[episodeId]/verification-details/route';

describe('episode verification details', () => {
  it('does not expose verification claims for assessment audio', async () => {
    boundary.episode.mockResolvedValue({
      userId: 'learner',
      status: 'SCRIPT_READY',
      assessmentAudioAssessmentId: 'assessment',
    });
    const response = await GET(
      new NextRequest('http://localhost/api/v1/episodes/id/verification-details'),
      {
        params: Promise.resolve({ episodeId: 'id' }),
      }
    );
    expect(response.status).toBe(404);
    expect(boundary.script).not.toHaveBeenCalled();
    expect(boundary.discovery).not.toHaveBeenCalled();
  });
});
