// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { SpeakingDeletionConflict } from '@/lib/sidedoor/jobs/stitch/speaking-grading-deletion';
import { PrerequisiteDeletionConflict } from '@/lib/classes/help/prerequisite-deletion';

const boundary = vi.hoisted(() => ({ kind: 'speaking' }));

vi.mock('@/lib/api-keys', () => ({ authenticateRequest: async () => ({ userId: 'learner' }) }));
vi.mock('@/lib/sidedoor/access/core/http', () => ({
  accessOperation: async (
    _request: Request,
    _browser: boolean,
    operation: () => Promise<Response>
  ) => operation(),
}));
vi.mock('@/lib/sidedoor/access/deletion/profile-deletion', () => ({
  deleteOwnSottoProfile: async () => {
    throw boundary.kind === 'speaking'
      ? new SpeakingDeletionConflict()
      : new PrerequisiteDeletionConflict();
  },
  deleteSottoProfile: async () => {
    throw boundary.kind === 'speaking'
      ? new SpeakingDeletionConflict()
      : new PrerequisiteDeletionConflict();
  },
}));

import { DELETE as deleteOwn } from '@/app/api/v1/users/me/route';
import { DELETE as deleteProfile } from '@/app/api/v1/profiles/[id]/route';

describe('retained work protects profile deletion', () => {
  it.each([
    ['speaking', 'Speaking work'],
    ['prerequisite', 'Prerequisite work'],
  ])('reports %s conflict when deleting the current profile', async (kind, message) => {
    boundary.kind = kind;
    const request = new NextRequest('http://localhost/api/v1/users/me', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    const response = await deleteOwn(request);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining(message),
    });
  });

  it.each([
    ['speaking', 'Speaking work'],
    ['prerequisite', 'Prerequisite work'],
  ])('reports %s conflict when deleting a managed profile', async (kind, message) => {
    boundary.kind = kind;
    const request = new NextRequest('http://localhost/api/v1/profiles/learner', {
      method: 'DELETE',
    });
    const response = await deleteProfile(request, { params: Promise.resolve({ id: 'learner' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining(message),
    });
  });
});
