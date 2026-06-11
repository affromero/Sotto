import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const TEST_USER_EMAIL = 'test-e2e@example.com';
const TEST_USER_NAME = 'E2E Test User';

/**
 * Seeds a test user and all related data for E2E tests.
 * Returns a NextAuth-compatible session token.
 *
 * Idempotent — safe to call multiple times.
 */
export async function seedTestUser() {
  // Upsert the test user (reset onboarding so tests can re-run)
  const user = await prisma.user.upsert({
    where: { email: TEST_USER_EMAIL },
    update: { hasCompletedOnboarding: false },
    create: {
      id: `e2e-user-${randomUUID().slice(0, 8)}`,
      email: TEST_USER_EMAIL,
      name: TEST_USER_NAME,
      handle: 'e2e-test',
      role: 'USER',
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
  const testPodcast = await prisma.podcast.upsert({
    where: { id: 'e2e-podcast' },
    update: {},
    create: {
      id: 'e2e-podcast',
      title: 'E2E Test Podcast',
      topic: 'Testing',
      status: 'READY',
      audioUrl: 'https://media.example.com/e2e/test-audio.mp3',
      duration: 300,
      visibility: 'PUBLIC',
      userId: user.id,
    },
  });

  // Second user for access and ownership tests
  const otherUser = await prisma.user.upsert({
    where: { email: 'test-other@example.com' },
    update: {},
    create: {
      id: `e2e-other-${randomUUID().slice(0, 8)}`,
      email: 'test-other@example.com',
      name: 'E2E Other User',
      handle: 'e2e-other',
      role: 'USER',
    },
  });

  // Other user's podcast for ownership-boundary tests
  const otherPodcast = await prisma.podcast.upsert({
    where: { id: 'e2e-other-podcast' },
    update: {},
    create: {
      id: 'e2e-other-podcast',
      title: 'E2E Other Podcast',
      topic: 'Independent ownership content',
      status: 'READY',
      audioUrl: 'https://media.example.com/e2e/test-audio-other.mp3',
      duration: 240,
      visibility: 'PUBLIC',
      userId: otherUser.id,
    },
  });

  // SCRIPT_READY podcast for script approve/regenerate tests
  const scriptReadyPodcast = await prisma.podcast.upsert({
    where: { id: 'e2e-script-ready' },
    update: { status: 'SCRIPT_READY' },
    create: {
      id: 'e2e-script-ready',
      title: 'E2E Script Ready Podcast',
      topic: 'Script workflow testing',
      status: 'SCRIPT_READY',
      visibility: 'PRIVATE',
      userId: user.id,
    },
  });

  // Script for testPodcast
  const scriptTurns = [
    { speaker: 'HOST', text: 'Welcome to our test podcast about testing.' },
    { speaker: 'EXPERT', text: 'Thanks for having me. Testing is crucial for quality software.' },
  ];
  await prisma.script.upsert({
    where: { podcastId: testPodcast.id },
    update: {},
    create: {
      podcastId: testPodcast.id,
      turns: scriptTurns,
      markdown: scriptTurns.map((t) => `**${t.speaker}**: ${t.text}`).join('\n\n'),
      version: 1,
    },
  });

  // Script for scriptReadyPodcast
  const scriptReadyTurns = [
    { speaker: 'HOST', text: 'This script is ready for approval.' },
    { speaker: 'EXPERT', text: 'The verification process has completed successfully.' },
  ];
  await prisma.script.upsert({
    where: { podcastId: scriptReadyPodcast.id },
    update: {},
    create: {
      podcastId: scriptReadyPodcast.id,
      turns: scriptReadyTurns,
      markdown: scriptReadyTurns.map((t) => `**${t.speaker}**: ${t.text}`).join('\n\n'),
      version: 1,
    },
  });

  // Interaction (ANSWERED, PUBLIC) on testPodcast
  const interaction = await prisma.interaction.upsert({
    where: { id: 'e2e-interaction' },
    update: {},
    create: {
      id: 'e2e-interaction',
      podcastId: testPodcast.id,
      userId: user.id,
      status: 'ANSWERED',
      question: 'What makes testing so important?',
      timestamp: 30.0,
      answer: 'Testing ensures software quality and catches bugs early.',
      visibility: 'PUBLIC',
    },
  });

  // PodcastFeature for testPodcast (non-zero values for quality route)
  await prisma.podcastFeature.upsert({
    where: { podcastId: testPodcast.id },
    update: {},
    create: {
      podcastId: testPodcast.id,
      avgCompletionRate: 0.75,
      medianCompletionRate: 0.8,
      totalUniqueListeners: 10,
      totalListenMinutes: 50.0,
      segmentCount: 2,
      durationSeconds: 300,
    },
  });

  // Save (user → otherPodcast)
  await prisma.save.upsert({
    where: { userId_podcastId: { userId: user.id, podcastId: otherPodcast.id } },
    update: {},
    create: {
      userId: user.id,
      podcastId: otherPodcast.id,
    },
  });

  // Sub-tag under 'technology'
  const techTag = await prisma.tag.findUnique({ where: { slug: 'technology' } });
  const subTag = await prisma.tag.upsert({
    where: { slug: 'e2e-subtag' },
    update: {},
    create: {
      name: 'AI Ethics',
      slug: 'e2e-subtag',
      parentId: techTag?.id,
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
      where: { id: 'e2e-notif-script' },
      update: {},
      create: {
        id: 'e2e-notif-script',
        userId: user.id,
        type: 'SCRIPT_READY',
        title: 'Script ready',
        message: 'Your script is ready for review.',
        read: false,
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

  // FAILED podcast for error-state E2E tests
  const failedPodcast = await prisma.podcast.upsert({
    where: { id: 'e2e-failed-podcast' },
    update: { status: 'FAILED' },
    create: {
      id: 'e2e-failed-podcast',
      title: 'E2E Failed Podcast',
      topic: 'Generation failure testing',
      status: 'FAILED',
      visibility: 'PUBLIC',
      userId: user.id,
    },
  });

  // Empty-feed user (no follows, no content) for empty-state E2E tests
  const emptyUser = await prisma.user.upsert({
    where: { email: 'test-empty@example.com' },
    update: {},
    create: {
      id: `e2e-empty-${randomUUID().slice(0, 8)}`,
      email: 'test-empty@example.com',
      name: 'E2E Empty User',
      handle: 'e2e-empty',
      role: 'USER',
    },
  });

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

  // Fresh invite code for redeem API tests (delete + recreate each run)
  const freshInviteCode = `e2e-invite-fresh-${Date.now()}`;
  await prisma.invitationLink.create({
    data: {
      code: freshInviteCode,
      createdBy: user.id,
      enabled: true,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    user,
    otherUser,
    sessionToken,
    testPodcast,
    otherPodcast,
    scriptReadyPodcast,
    interaction,
    subTag,
    notifications,
    failedPodcast,
    emptyUser,
    draft,
    freshInviteCode,
  };
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
