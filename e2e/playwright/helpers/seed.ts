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
  let testPodcast = await prisma.podcast.findFirst({
    where: { userId: user.id, status: 'READY' },
  });
  if (!testPodcast) {
    testPodcast = await prisma.podcast.create({
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

  // Second user for follow/profile tests
  const otherUser = await prisma.user.upsert({
    where: { email: 'test-other@sotto.fm' },
    update: {},
    create: {
      id: `e2e-other-${randomUUID().slice(0, 8)}`,
      email: 'test-other@sotto.fm',
      name: 'E2E Other User',
      handle: 'e2e-other',
      role: 'USER',
      plan: 'FREE',
    },
  });

  // Other user's podcast for fork tests
  const otherPodcast = await prisma.podcast.findFirst({ where: { userId: otherUser.id, status: 'READY' } });
  if (!otherPodcast) {
    await prisma.podcast.create({
      data: {
        title: 'E2E Other Podcast',
        topic: 'Forkable Content',
        status: 'READY',
        audioUrl: 'https://sotto.fm/test-audio-other.mp3',
        duration: 240,
        visibility: 'PUBLIC',
        userId: otherUser.id,
      },
    });
  }

  // Collection owned by test user
  const collection = await prisma.collection.upsert({
    where: { id: 'e2e-collection' },
    update: {},
    create: {
      id: 'e2e-collection',
      name: 'E2E Test Collection',
      description: 'Collection for E2E tests',
      userId: user.id,
      isPublic: true,
      podcastCount: 1,
    },
  });

  // Add podcast to collection
  await prisma.collectionItem.upsert({
    where: { collectionId_podcastId: { collectionId: collection.id, podcastId: testPodcast.id } },
    update: {},
    create: {
      collectionId: collection.id,
      podcastId: testPodcast.id,
      order: 0,
    },
  });

  // Notifications (2 for test user)
  const notifications = await Promise.all([
    prisma.notification.upsert({
      where: { id: 'e2e-notif-ready' },
      update: {},
      create: {
        id: 'e2e-notif-ready',
        userId: user.id,
        type: 'PODCAST_READY',
        title: 'Your podcast is ready',
        message: 'Your podcast "E2E Test Podcast" is ready to listen.',
        data: { podcastId: testPodcast.id },
        read: false,
      },
    }),
    prisma.notification.upsert({
      where: { id: 'e2e-notif-follower' },
      update: {},
      create: {
        id: 'e2e-notif-follower',
        userId: user.id,
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        message: 'e2e-other started following you.',
        read: false,
      },
    }),
  ]);

  // Saved Ideas (2 for test user)
  const ideas = await Promise.all([
    prisma.savedIdea.upsert({
      where: { userId_questionId: { userId: user.id, questionId: 'q-ai' } },
      update: {},
      create: {
        userId: user.id,
        questionId: 'q-ai',
        question: 'What if AI could write music?',
        category: 'Technology',
        tagSlugs: ['technology', 'music'],
      },
    }),
    prisma.savedIdea.upsert({
      where: { userId_questionId: { userId: user.id, questionId: 'q-space' } },
      update: {},
      create: {
        userId: user.id,
        questionId: 'q-space',
        question: 'Could we terraform Mars?',
        category: 'Science',
        tagSlugs: ['science', 'space'],
      },
    }),
  ]);

  // Tags (4)
  const tagData = [
    { name: 'Technology', slug: 'technology' },
    { name: 'Science', slug: 'science' },
    { name: 'Music', slug: 'music' },
    { name: 'History', slug: 'history' },
  ];
  for (const t of tagData) {
    await prisma.tag.upsert({
      where: { slug: t.slug },
      update: {},
      create: t,
    });
  }

  // Draft podcast
  const draft = await prisma.podcast.upsert({
    where: { id: 'e2e-draft' },
    update: {},
    create: {
      id: 'e2e-draft',
      title: 'Draft Podcast',
      topic: 'Saved draft topic',
      status: 'PENDING',
      visibility: 'PRIVATE',
      userId: user.id,
    },
  });

  // Invitation link for invite page tests
  await prisma.invitationLink.upsert({
    where: { code: 'e2e-invite-code' },
    update: {},
    create: {
      code: 'e2e-invite-code',
      createdBy: user.id,
      enabled: true,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { user, otherUser, sessionToken, testPodcast, collection, ideas, notifications, draft };
}

// Run as standalone script for CI seeding
const isMainModule = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMainModule) {
  seedTestUser()
    .then(({ user, otherUser }) => {
      console.log(`Seeded test user: ${user.email} (${user.id})`);
      console.log(`Seeded other user: ${otherUser.email} (${otherUser.id})`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
