import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const TEST_USER_EMAIL = 'test-e2e@sotto.fm';
const TEST_USER_NAME = 'E2E Test User';

/**
 * Seeds a test user and a ready podcast for E2E tests.
 * Returns a NextAuth-compatible session token.
 *
 * Idempotent — safe to call multiple times.
 */
export async function seedTestUser() {
  // Upsert the test user
  const user = await prisma.user.upsert({
    where: { email: TEST_USER_EMAIL },
    update: {},
    create: {
      id: `e2e-user-${randomUUID().slice(0, 8)}`,
      email: TEST_USER_EMAIL,
      name: TEST_USER_NAME,
      handle: 'e2e-test',
      role: 'USER',
      plan: 'FREE',
    },
  });

  // Create a session token for NextAuth
  const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  const sessionToken = randomUUID();

  // NextAuth v5 uses the Session model
  await prisma.session.upsert({
    where: { sessionToken },
    update: { expires: sessionExpiry },
    create: {
      sessionToken,
      userId: user.id,
      expires: sessionExpiry,
    },
  });

  // Seed a ready podcast for player tests
  const existingPodcast = await prisma.podcast.findFirst({
    where: { userId: user.id, status: 'READY' },
  });

  if (!existingPodcast) {
    await prisma.podcast.create({
      data: {
        title: 'E2E Test Podcast',
        topic: 'Testing',
        status: 'READY',
        audioUrl: 'https://sotto.fm/test-audio.mp3',
        duration: 300,
        visibility: 'PUBLIC',
        userId: user.id,
      },
    });
  }

  return { user, sessionToken };
}

// Run as standalone script for CI seeding
const isMainModule = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMainModule) {
  seedTestUser()
    .then(({ user }) => {
      console.log(`Seeded test user: ${user.email} (${user.id})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
