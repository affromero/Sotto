import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

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

  console.log(`✅ Created ${tags.length} tags`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
