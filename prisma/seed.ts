import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.warn('🌱 Seeding database...');

  // Create default tags
  const tags = [
    { name: 'Technology', slug: 'technology' },
    { name: 'Science', slug: 'science' },
    { name: 'Business', slug: 'business' },
    { name: 'History', slug: 'history' },
    { name: 'Philosophy', slug: 'philosophy' },
    { name: 'Health', slug: 'health' },
    { name: 'AI & Machine Learning', slug: 'ai-ml' },
    { name: 'Programming', slug: 'programming' },
    { name: 'Mathematics', slug: 'mathematics' },
    { name: 'Psychology', slug: 'psychology' },
    { name: 'Economics', slug: 'economics' },
    { name: 'Art & Design', slug: 'art-design' },
  ];

  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: {},
      create: tag,
    });
  }

  console.warn(`✅ Created ${tags.length} tags`);

  // Upsert @sotto system account
  await prisma.user.upsert({
    where: { email: 'system@sotto.fm' },
    update: {
      handle: 'sotto',
      role: 'SYSTEM',
      name: 'Sotto',
      bio: 'The official Sotto account. Curated podcasts and platform highlights.',
    },
    create: {
      email: 'system@sotto.fm',
      handle: 'sotto',
      role: 'SYSTEM',
      name: 'Sotto',
      bio: 'The official Sotto account. Curated podcasts and platform highlights.',
    },
  });

  console.warn('✅ Created @sotto system account');

  // Seed reserved handles
  const reservedHandles = [
    'sotto',
    'admin',
    'support',
    'help',
    'official',
    'system',
    'api',
    'feed',
    'create',
    'settings',
    'dashboard',
    'billing',
    'pricing',
    'auth',
    'login',
    'signup',
    'onboarding',
    'podcast',
    'profile',
    'team',
    'notifications',
    'analytics',
    'explore',
    'search',
    'trending',
    'home',
    'about',
    'contact',
    'terms',
    'privacy',
  ];

  for (const handle of reservedHandles) {
    await prisma.reservedHandle.upsert({
      where: { handle },
      update: {},
      create: {
        handle,
        reason: 'System reserved',
      },
    });
  }

  console.warn(`✅ Reserved ${reservedHandles.length} handles`);

  // Set handle for known admin (no-op if user hasn't signed up yet)
  const adminHandles: Record<string, string> = {
    'andres2912@gmail.com': 'andres',
  };

  for (const [email, handle] of Object.entries(adminHandles)) {
    const updated = await prisma.user.updateMany({
      where: { email, handle: null },
      data: { handle },
    });
    if (updated.count > 0) {
      console.warn(`✅ Set handle @${handle} for ${email}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
