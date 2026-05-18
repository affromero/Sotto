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
    { name: 'Music', slug: 'music' },
    { name: 'Politics & Society', slug: 'politics-society' },
    { name: 'Environment', slug: 'environment' },
    { name: 'Language & Literature', slug: 'language-literature' },
    { name: 'Sports & Fitness', slug: 'sports-fitness' },
    { name: 'Education', slug: 'education' },
    // Audience tags
    { name: 'Kids (6-10)', slug: 'kids' },
    { name: 'Teens (11-16)', slug: 'teens' },
    { name: 'Family-Friendly', slug: 'family-friendly' },
    { name: 'General Audience', slug: 'general-audience' },
    { name: 'Mature Topics', slug: 'mature-topics' },
  ];

  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: {},
      create: tag,
    });
  }

  console.warn(`✅ Created ${tags.length} tags`);

  // Sub-interest tags (1-level deep under each parent category)
  const subInterests: Record<string, Array<{ name: string; slug: string }>> = {
    technology: [
      { name: 'Quantum Computing', slug: 'quantum-computing' },
      { name: 'Cybersecurity', slug: 'cybersecurity' },
      { name: 'Blockchain', slug: 'blockchain' },
      { name: 'Robotics', slug: 'robotics' },
      { name: 'Space Tech', slug: 'space-tech' },
      { name: 'Semiconductors', slug: 'semiconductors' },
      { name: 'AR/VR', slug: 'ar-vr' },
    ],
    science: [
      { name: 'Neuroscience', slug: 'neuroscience' },
      { name: 'Climate Science', slug: 'climate-science' },
      { name: 'Genetics', slug: 'genetics' },
      { name: 'Astrophysics', slug: 'astrophysics' },
      { name: 'Marine Biology', slug: 'marine-biology' },
      { name: 'Materials Science', slug: 'materials-science' },
    ],
    business: [
      { name: 'Startups', slug: 'startups' },
      { name: 'Leadership', slug: 'leadership' },
      { name: 'Product Management', slug: 'product-management' },
      { name: 'Venture Capital', slug: 'venture-capital' },
      { name: 'Marketing Strategy', slug: 'marketing-strategy' },
      { name: 'Supply Chain', slug: 'supply-chain' },
    ],
    history: [
      { name: 'Ancient Civilizations', slug: 'ancient-civilizations' },
      { name: 'World Wars', slug: 'world-wars' },
      { name: 'Cold War', slug: 'cold-war' },
      { name: 'Medieval History', slug: 'medieval-history' },
      { name: 'History of Science', slug: 'history-of-science' },
      { name: 'Colonial History', slug: 'colonial-history' },
    ],
    philosophy: [
      { name: 'Ethics', slug: 'ethics' },
      { name: 'Existentialism', slug: 'existentialism' },
      { name: 'Philosophy of Mind', slug: 'philosophy-of-mind' },
      { name: 'Political Philosophy', slug: 'political-philosophy' },
      { name: 'Eastern Philosophy', slug: 'eastern-philosophy' },
      { name: 'Logic', slug: 'logic' },
    ],
    health: [
      { name: 'Nutrition', slug: 'nutrition' },
      { name: 'Mental Health', slug: 'mental-health' },
      { name: 'Sleep Science', slug: 'sleep-science' },
      { name: 'Exercise Science', slug: 'exercise-science' },
      { name: 'Longevity', slug: 'longevity' },
      { name: 'Epidemiology', slug: 'epidemiology' },
    ],
    'ai-ml': [
      { name: 'Large Language Models', slug: 'large-language-models' },
      { name: 'Computer Vision', slug: 'computer-vision' },
      { name: 'Reinforcement Learning', slug: 'reinforcement-learning' },
      { name: 'AI Ethics', slug: 'ai-ethics' },
      { name: 'Neural Networks', slug: 'neural-networks' },
      { name: 'AI in Healthcare', slug: 'ai-in-healthcare' },
    ],
    programming: [
      { name: 'Web Development', slug: 'web-development' },
      { name: 'Systems Programming', slug: 'systems-programming' },
      { name: 'DevOps', slug: 'devops' },
      { name: 'Functional Programming', slug: 'functional-programming' },
      { name: 'Game Development', slug: 'game-development' },
      { name: 'Open Source', slug: 'open-source' },
    ],
    mathematics: [
      { name: 'Statistics', slug: 'statistics' },
      { name: 'Number Theory', slug: 'number-theory' },
      { name: 'Cryptography', slug: 'cryptography' },
      { name: 'Game Theory', slug: 'game-theory' },
      { name: 'Topology', slug: 'topology' },
      { name: 'Applied Mathematics', slug: 'applied-mathematics' },
    ],
    psychology: [
      { name: 'Cognitive Biases', slug: 'cognitive-biases' },
      { name: 'Behavioral Economics', slug: 'behavioral-economics' },
      { name: 'Developmental Psychology', slug: 'developmental-psychology' },
      { name: 'Social Psychology', slug: 'social-psychology' },
      { name: 'Neuropsychology', slug: 'neuropsychology' },
      { name: 'Positive Psychology', slug: 'positive-psychology' },
    ],
    economics: [
      { name: 'Macroeconomics', slug: 'macroeconomics' },
      { name: 'Microeconomics', slug: 'microeconomics' },
      { name: 'International Trade', slug: 'international-trade' },
      { name: 'Monetary Policy', slug: 'monetary-policy' },
      { name: 'Labor Economics', slug: 'labor-economics' },
      { name: 'Development Economics', slug: 'development-economics' },
    ],
    'art-design': [
      { name: 'UI/UX Design', slug: 'ui-ux-design' },
      { name: 'Typography', slug: 'typography' },
      { name: 'Architecture', slug: 'architecture' },
      { name: 'Digital Art', slug: 'digital-art' },
      { name: 'Art History', slug: 'art-history' },
      { name: 'Graphic Design', slug: 'graphic-design' },
    ],
    music: [
      { name: 'Music Theory', slug: 'music-theory' },
      { name: 'Jazz', slug: 'jazz' },
      { name: 'Classical Music', slug: 'classical-music' },
      { name: 'Music Production', slug: 'music-production' },
      { name: 'Hip Hop Culture', slug: 'hip-hop-culture' },
      { name: 'World Music', slug: 'world-music' },
      { name: 'Electronic Music', slug: 'electronic-music' },
    ],
    'politics-society': [
      { name: 'Geopolitics', slug: 'geopolitics' },
      { name: 'Human Rights', slug: 'human-rights' },
      { name: 'Urban Planning', slug: 'urban-planning' },
      { name: 'Immigration', slug: 'immigration' },
      { name: 'Media & Journalism', slug: 'media-journalism' },
      { name: 'Social Movements', slug: 'social-movements' },
      { name: 'Public Policy', slug: 'public-policy' },
    ],
    environment: [
      { name: 'Climate Change', slug: 'climate-change' },
      { name: 'Renewable Energy', slug: 'renewable-energy' },
      { name: 'Conservation', slug: 'conservation' },
      { name: 'Sustainable Agriculture', slug: 'sustainable-agriculture' },
      { name: 'Ocean Science', slug: 'ocean-science' },
      { name: 'Biodiversity', slug: 'biodiversity' },
    ],
    'language-literature': [
      { name: 'Creative Writing', slug: 'creative-writing' },
      { name: 'Poetry', slug: 'poetry' },
      { name: 'Science Fiction', slug: 'science-fiction' },
      { name: 'Linguistics', slug: 'linguistics' },
      { name: 'World Literature', slug: 'world-literature' },
      { name: 'Storytelling', slug: 'storytelling' },
    ],
    'sports-fitness': [
      { name: 'Sports Analytics', slug: 'sports-analytics' },
      { name: 'Olympic Sports', slug: 'olympic-sports' },
      { name: 'Martial Arts', slug: 'martial-arts' },
      { name: 'Endurance Training', slug: 'endurance-training' },
      { name: 'Sports Psychology', slug: 'sports-psychology' },
      { name: 'Biomechanics', slug: 'biomechanics' },
    ],
    education: [
      { name: 'Pedagogy', slug: 'pedagogy' },
      { name: 'EdTech', slug: 'edtech' },
      { name: 'Homeschooling', slug: 'homeschooling' },
      { name: 'Higher Education', slug: 'higher-education' },
      { name: 'Learning Science', slug: 'learning-science' },
      { name: 'STEM Education', slug: 'stem-education' },
    ],
  };

  let subTagCount = 0;
  for (const [parentSlug, children] of Object.entries(subInterests)) {
    const parent = await prisma.tag.findUnique({ where: { slug: parentSlug } });
    if (!parent) continue;

    for (const child of children) {
      await prisma.tag.upsert({
        where: { slug: child.slug },
        update: { parentId: parent.id },
        create: { name: child.name, slug: child.slug, parentId: parent.id },
      });
      subTagCount++;
    }
  }

  console.warn(`✅ Created ${subTagCount} sub-interest tags`);

  // Taxonomy tags: Format, Language, Episode Type, Production
  const taxonomyCategories: Array<{
    name: string;
    slug: string;
    children: Array<{ name: string; slug: string }>;
  }> = [
    {
      name: 'Format',
      slug: 'format',
      children: [
        { name: 'Conversation', slug: 'format-conversation' },
        { name: 'Interview', slug: 'format-interview' },
        { name: 'Monologue', slug: 'format-monologue' },
        { name: 'Debate', slug: 'format-debate' },
        { name: 'Q&A', slug: 'format-qa' },
        { name: 'Storytelling', slug: 'format-storytelling' },
        { name: 'Tutorial', slug: 'format-tutorial' },
      ],
    },
    {
      name: 'Language',
      slug: 'language',
      children: [
        { name: 'English', slug: 'lang-en' },
        { name: 'Spanish', slug: 'lang-es' },
        { name: 'French', slug: 'lang-fr' },
        { name: 'German', slug: 'lang-de' },
        { name: 'Portuguese', slug: 'lang-pt' },
        { name: 'Japanese', slug: 'lang-ja' },
        { name: 'Korean', slug: 'lang-ko' },
        { name: 'Chinese', slug: 'lang-zh' },
        { name: 'Arabic', slug: 'lang-ar' },
        { name: 'Hindi', slug: 'lang-hi' },
        { name: 'Russian', slug: 'lang-ru' },
        { name: 'Other', slug: 'lang-other' },
      ],
    },
    {
      name: 'Episode Type',
      slug: 'episode-type',
      children: [
        { name: 'ELI5', slug: 'type-eli5' },
        { name: 'Deep Dive', slug: 'type-deep-dive' },
        { name: 'Quick Overview', slug: 'type-quick-overview' },
        { name: 'Current Events', slug: 'type-current-events' },
        { name: 'Research Paper', slug: 'type-research-paper' },
        { name: 'Book Summary', slug: 'type-book-summary' },
        { name: 'How-To Guide', slug: 'type-how-to' },
        { name: 'Explainer', slug: 'type-explainer' },
      ],
    },
    {
      name: 'Production',
      slug: 'production',
      children: [
        { name: 'AI-Generated', slug: 'prod-ai-generated' },
        { name: 'Human-Created', slug: 'prod-human-created' },
        { name: 'AI-Assisted', slug: 'prod-ai-assisted' },
        { name: 'Imported', slug: 'prod-imported' },
      ],
    },
  ];

  let taxonomyTagCount = 0;
  for (const category of taxonomyCategories) {
    const parent = await prisma.tag.upsert({
      where: { slug: category.slug },
      update: {},
      create: { name: category.name, slug: category.slug },
    });

    for (const child of category.children) {
      await prisma.tag.upsert({
        where: { slug: child.slug },
        update: { parentId: parent.id },
        create: { name: child.name, slug: child.slug, parentId: parent.id },
      });
      taxonomyTagCount++;
    }
  }

  console.warn(`✅ Created ${taxonomyCategories.length} taxonomy categories with ${taxonomyTagCount} tags`);

  // Upsert @sotto system account
  await prisma.user.upsert({
    where: { email: 'system@example.com' },
    update: {
      handle: 'sotto',
      role: 'SYSTEM',
      name: 'Sotto',
      bio: 'The official Sotto account. Curated podcasts and platform highlights.',
      image: '/brand/profile?v=amber',
    },
    create: {
      email: 'system@example.com',
      handle: 'sotto',
      role: 'SYSTEM',
      name: 'Sotto',
      bio: 'The official Sotto account. Curated podcasts and platform highlights.',
      image: '/brand/profile?v=amber',
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
