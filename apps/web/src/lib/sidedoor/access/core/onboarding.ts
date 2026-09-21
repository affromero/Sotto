import { prismaUnfiltered } from '@/lib/prisma';

/** The caller supplies the learner selected by shared authentication. Reads never create authority. */
export async function getLearnerOnboarding(userId: string) {
  if (!userId) throw new Error('Choose an authenticated learner');
  const user = await prismaUnfiltered.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, hasCompletedOnboarding: true, createdAt: true },
  });
  return {
    completed: user.hasCompletedOnboarding,
    resumeKey: `${user.id}:${user.createdAt.toISOString()}`,
  };
}
