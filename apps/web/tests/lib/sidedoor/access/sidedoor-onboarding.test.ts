// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLearnerOnboarding } from '@/lib/sidedoor/access/core/onboarding';

const database = vi.hoisted(() => ({
  users: new Map<string, { id: string; hasCompletedOnboarding: boolean; createdAt: Date }>(),
}));
vi.mock('@/lib/prisma', () => ({
  prismaUnfiltered: {
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const user = database.users.get(where.id);
        if (!user) throw new Error('Learner is missing');
        return user;
      },
    },
  },
}));
beforeEach(() => {
  database.users.clear();
  const createdAt = new Date('2026-09-12T00:00:00.000Z');
  database.users.set('owner', { id: 'owner', hasCompletedOnboarding: true, createdAt });
  database.users.set('learner', { id: 'learner', hasCompletedOnboarding: false, createdAt });
});
describe('learner onboarding without implicit account creation', () => {
  it('uses the selected learner completion and isolates resume state even when creation times match', async () => {
    const owner = await getLearnerOnboarding('owner');
    const learner = await getLearnerOnboarding('learner');
    expect(owner.completed).toBe(true);
    expect(learner.completed).toBe(false);
    expect(owner.resumeKey).not.toBe(learner.resumeKey);
  });
  it('rejects a missing or empty learner without substituting the owner', async () => {
    await expect(getLearnerOnboarding('removed')).rejects.toThrow('Learner is missing');
    await expect(getLearnerOnboarding('')).rejects.toThrow('Choose an authenticated learner');
    expect([...database.users.keys()]).toEqual(['owner', 'learner']);
  });
});
