/* eslint-disable no-console */
/**
 * Backfill topic tags for existing podcasts.
 *
 * Reads each podcast's Discovery topic + focusAreas (or podcast.topic for imports),
 * runs keyword matching against the tag pool, and upserts PodcastTag records.
 *
 * Usage:
 *   npx tsx scripts/backfill-topic-tags.ts           # dry run (default)
 *   npx tsx scripts/backfill-topic-tags.ts --apply    # apply changes
 */

import { PrismaClient } from '@prisma/client';

// Inline the matching logic to avoid import path issues with the monorepo.
// The canonical implementation lives in apps/web/src/lib/topic-tagger.ts.

const TAG_KEYWORDS: Record<string, string[]> = {
  technology: ['technology', 'tech', 'software', 'hardware', 'computing', 'digital', 'internet'],
  science: ['science', 'scientific', 'research', 'experiment', 'laboratory'],
  business: ['business', 'company', 'corporate', 'enterprise', 'industry', 'commerce'],
  history: ['history', 'historical', 'ancient', 'medieval', 'century', 'civilization'],
  philosophy: ['philosophy', 'philosophical', 'metaphysics', 'epistemology'],
  health: ['health', 'medical', 'medicine', 'wellness', 'healthcare', 'clinical'],
  'ai-ml': ['artificial intelligence', 'machine learning', 'deep learning', 'ai', 'ml', 'natural language processing', 'nlp', 'transformer', 'generative ai'],
  programming: ['programming', 'coding', 'software development', 'developer', 'code', 'engineer'],
  mathematics: ['mathematics', 'math', 'mathematical', 'theorem', 'equation'],
  psychology: ['psychology', 'psychological', 'cognitive', 'behavior'],
  economics: ['economics', 'economy', 'economic', 'fiscal'],
  'art-design': ['art', 'design', 'creative', 'aesthetic', 'visual'],
  music: ['music', 'musical', 'musician', 'song', 'melody', 'rhythm'],
  'politics-society': ['politics', 'political', 'government', 'democracy', 'policy', 'society'],
  environment: ['environment', 'environmental', 'ecology', 'ecosystem', 'sustainability'],
  'language-literature': ['literature', 'literary', 'novel', 'fiction', 'author', 'writing'],
  'sports-fitness': ['sports', 'sport', 'fitness', 'athletic', 'athlete', 'training'],
  education: ['education', 'educational', 'learning', 'teaching', 'school', 'university'],
  'quantum-computing': ['quantum computing', 'quantum computer', 'qubit', 'quantum supremacy'],
  cybersecurity: ['cybersecurity', 'cyber security', 'hacking', 'malware', 'infosec'],
  blockchain: ['blockchain', 'cryptocurrency', 'crypto', 'bitcoin', 'ethereum', 'web3'],
  robotics: ['robotics', 'robot', 'autonomous', 'automation'],
  'space-tech': ['space technology', 'spacex', 'nasa', 'satellite', 'rocket', 'space exploration'],
  semiconductors: ['semiconductor', 'chip', 'transistor', 'silicon', 'fabrication'],
  'ar-vr': ['augmented reality', 'virtual reality', 'mixed reality', 'metaverse'],
  neuroscience: ['neuroscience', 'neuron', 'brain', 'neural', 'cortex', 'synapse'],
  'climate-science': ['climate science', 'climate model', 'atmospheric', 'greenhouse'],
  genetics: ['genetics', 'genetic', 'dna', 'genome', 'gene editing', 'crispr'],
  astrophysics: ['astrophysics', 'cosmology', 'universe', 'galaxy', 'black hole', 'dark matter'],
  'marine-biology': ['marine biology', 'ocean life', 'coral reef', 'marine ecosystem'],
  'materials-science': ['materials science', 'nanomaterial', 'polymer', 'superconductor'],
  startups: ['startup', 'startups', 'founder', 'bootstrapping', 'seed funding'],
  leadership: ['leadership', 'leader', 'management', 'executive'],
  'product-management': ['product management', 'product manager', 'roadmap', 'agile', 'scrum'],
  'venture-capital': ['venture capital', 'angel investor', 'funding round', 'series a'],
  'marketing-strategy': ['marketing', 'branding', 'growth hacking', 'content marketing'],
  'supply-chain': ['supply chain', 'logistics', 'procurement', 'inventory'],
  'ancient-civilizations': ['ancient civilization', 'ancient rome', 'ancient greece', 'ancient egypt', 'mesopotamia'],
  'world-wars': ['world war', 'wwii', 'ww2', 'nazi', 'allied forces'],
  'cold-war': ['cold war', 'soviet union', 'iron curtain', 'cuban missile'],
  'medieval-history': ['medieval', 'middle ages', 'feudal', 'crusade', 'renaissance'],
  'history-of-science': ['history of science', 'scientific revolution', 'enlightenment'],
  ethics: ['ethics', 'ethical', 'morality', 'moral', 'bioethics'],
  existentialism: ['existentialism', 'existential', 'sartre', 'kierkegaard', 'nietzsche'],
  'philosophy-of-mind': ['philosophy of mind', 'consciousness', 'qualia', 'free will'],
  'political-philosophy': ['political philosophy', 'social contract', 'justice'],
  'eastern-philosophy': ['eastern philosophy', 'buddhism', 'taoism', 'zen', 'confucianism'],
  nutrition: ['nutrition', 'diet', 'vitamin', 'protein', 'food science'],
  'mental-health': ['mental health', 'depression', 'anxiety', 'psychotherapy'],
  'sleep-science': ['sleep science', 'circadian', 'insomnia', 'rem sleep'],
  'exercise-science': ['exercise science', 'kinesiology', 'strength training'],
  longevity: ['longevity', 'aging', 'anti-aging', 'lifespan', 'telomere'],
  epidemiology: ['epidemiology', 'pandemic', 'epidemic', 'infectious disease', 'vaccination'],
  'large-language-models': ['large language model', 'llm', 'gpt', 'claude', 'chatgpt', 'gemini', 'llama', 'language model'],
  'computer-vision': ['computer vision', 'image recognition', 'object detection'],
  'reinforcement-learning': ['reinforcement learning', 'reward function', 'q-learning', 'alphago'],
  'ai-ethics': ['ai ethics', 'ai bias', 'algorithmic fairness', 'ai safety', 'ai alignment'],
  'neural-networks': ['neural network', 'cnn', 'rnn', 'lstm', 'backpropagation'],
  'ai-in-healthcare': ['ai in healthcare', 'medical ai', 'diagnostic ai'],
  'web-development': ['web development', 'web dev', 'frontend', 'backend', 'fullstack', 'javascript', 'typescript', 'react'],
  'systems-programming': ['systems programming', 'operating system', 'kernel', 'rust', 'memory management'],
  devops: ['devops', 'ci/cd', 'kubernetes', 'docker', 'terraform'],
  'functional-programming': ['functional programming', 'haskell', 'erlang', 'immutability', 'monad'],
  'game-development': ['game development', 'game dev', 'game engine', 'unity', 'unreal engine'],
  'open-source': ['open source', 'open-source', 'github', 'free software', 'linux', 'foss'],
  statistics: ['statistics', 'statistical', 'probability', 'bayesian', 'regression'],
  'number-theory': ['number theory', 'prime number', 'riemann', 'modular arithmetic'],
  cryptography: ['cryptography', 'encryption', 'cipher', 'rsa', 'zero knowledge proof'],
  'game-theory': ['game theory', 'nash equilibrium', 'prisoner dilemma'],
  'cognitive-biases': ['cognitive bias', 'confirmation bias', 'anchoring', 'dunning-kruger'],
  'behavioral-economics': ['behavioral economics', 'nudge', 'prospect theory', 'kahneman', 'loss aversion'],
  'social-psychology': ['social psychology', 'conformity', 'groupthink', 'bystander effect'],
  'positive-psychology': ['positive psychology', 'well-being', 'resilience', 'flow state'],
  'climate-change': ['climate change', 'global warming', 'carbon emission', 'net zero'],
  'renewable-energy': ['renewable energy', 'solar power', 'wind power', 'clean energy'],
  conservation: ['conservation', 'wildlife conservation', 'endangered species', 'rewilding'],
  biodiversity: ['biodiversity', 'species diversity', 'extinction', 'invasive species'],
  geopolitics: ['geopolitics', 'geopolitical', 'international relations', 'diplomacy'],
  'human-rights': ['human rights', 'civil rights', 'civil liberties', 'equality'],
  'urban-planning': ['urban planning', 'city planning', 'zoning', 'public transit'],
  'creative-writing': ['creative writing', 'fiction writing', 'narrative', 'screenplay'],
  'science-fiction': ['science fiction', 'sci-fi', 'speculative fiction', 'dystopia', 'cyberpunk'],
  linguistics: ['linguistics', 'syntax', 'phonology', 'morphology', 'semantics'],
  'sports-analytics': ['sports analytics', 'sabermetrics', 'moneyball'],
  'martial-arts': ['martial arts', 'karate', 'judo', 'mma', 'boxing', 'jiu-jitsu'],
  'electronic-music': ['electronic music', 'techno', 'house music', 'edm', 'ambient'],
  jazz: ['jazz', 'bebop', 'swing', 'improvisation', 'miles davis'],
  'classical-music': ['classical music', 'orchestra', 'symphony', 'beethoven', 'mozart', 'bach'],
  'music-production': ['music production', 'mixing', 'mastering', 'daw', 'synthesizer'],
  edtech: ['edtech', 'educational technology', 'e-learning', 'online learning', 'mooc'],
};

const TAG_PARENT_MAP: Record<string, string> = {
  'quantum-computing': 'technology', cybersecurity: 'technology', blockchain: 'technology',
  robotics: 'technology', 'space-tech': 'technology', semiconductors: 'technology', 'ar-vr': 'technology',
  neuroscience: 'science', 'climate-science': 'science', genetics: 'science',
  astrophysics: 'science', 'marine-biology': 'science', 'materials-science': 'science',
  startups: 'business', leadership: 'business', 'product-management': 'business',
  'venture-capital': 'business', 'marketing-strategy': 'business', 'supply-chain': 'business',
  'ancient-civilizations': 'history', 'world-wars': 'history', 'cold-war': 'history',
  'medieval-history': 'history', 'history-of-science': 'history',
  ethics: 'philosophy', existentialism: 'philosophy', 'philosophy-of-mind': 'philosophy',
  'political-philosophy': 'philosophy', 'eastern-philosophy': 'philosophy',
  nutrition: 'health', 'mental-health': 'health', 'sleep-science': 'health',
  'exercise-science': 'health', longevity: 'health', epidemiology: 'health',
  'large-language-models': 'ai-ml', 'computer-vision': 'ai-ml', 'reinforcement-learning': 'ai-ml',
  'ai-ethics': 'ai-ml', 'neural-networks': 'ai-ml', 'ai-in-healthcare': 'ai-ml',
  'web-development': 'programming', 'systems-programming': 'programming', devops: 'programming',
  'functional-programming': 'programming', 'game-development': 'programming', 'open-source': 'programming',
  statistics: 'mathematics', 'number-theory': 'mathematics', cryptography: 'mathematics', 'game-theory': 'mathematics',
  'cognitive-biases': 'psychology', 'behavioral-economics': 'psychology',
  'social-psychology': 'psychology', 'positive-psychology': 'psychology',
  'climate-change': 'environment', 'renewable-energy': 'environment',
  conservation: 'environment', biodiversity: 'environment',
  geopolitics: 'politics-society', 'human-rights': 'politics-society', 'urban-planning': 'politics-society',
  'creative-writing': 'language-literature', 'science-fiction': 'language-literature', linguistics: 'language-literature',
  'sports-analytics': 'sports-fitness', 'martial-arts': 'sports-fitness',
  'electronic-music': 'music', jazz: 'music', 'classical-music': 'music', 'music-production': 'music',
  edtech: 'education',
};

function keywordMatches(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}s?\\b`, 'i');
  return re.test(text);
}

function matchTopicTags(topic: string, focusAreas: string[], maxTags = 5): string[] {
  const text = [topic, ...focusAreas].join(' ').toLowerCase();
  if (!text.trim()) return [];

  const scores = new Map<string, number>();
  for (const [slug, keywords] of Object.entries(TAG_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (keywordMatches(text, kw)) score += kw.length;
    }
    if (score > 0) scores.set(slug, score);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  const result = new Set<string>();
  let added = 0;
  for (const slug of ranked) {
    if (added >= maxTags) break;
    result.add(slug);
    added++;
    const parent = TAG_PARENT_MAP[slug];
    if (parent) result.add(parent);
  }
  return [...result];
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    if (dryRun) {
      console.log('DRY RUN — no changes will be written. Pass --apply to write.\n');
    }

    const podcasts = await prisma.podcast.findMany({
      select: {
        id: true,
        title: true,
        topic: true,
        suggestedTopic: true,
        discovery: { select: { topic: true, focusAreas: true } },
      },
    });

    console.log(`Found ${podcasts.length} podcasts to process.\n`);

    let totalTagsAdded = 0;
    let podcastsTagged = 0;

    for (const podcast of podcasts) {
      const topic = podcast.discovery?.topic || podcast.topic || podcast.suggestedTopic || '';
      const focusAreas = (podcast.discovery?.focusAreas as string[]) ?? [];
      const slugs = matchTopicTags(topic, focusAreas);

      if (slugs.length === 0) continue;

      const tags = await prisma.tag.findMany({
        where: { slug: { in: slugs } },
        select: { id: true, slug: true },
      });

      if (tags.length === 0) continue;

      podcastsTagged++;
      console.log(`${podcast.title || podcast.id}`);
      console.log(`  topic: "${topic}"`);
      if (focusAreas.length > 0) console.log(`  focusAreas: ${JSON.stringify(focusAreas)}`);
      console.log(`  tags: ${tags.map((t) => t.slug).join(', ')}`);

      if (!dryRun) {
        for (const tag of tags) {
          await prisma.podcastTag.upsert({
            where: { podcastId_tagId: { podcastId: podcast.id, tagId: tag.id } },
            update: {},
            create: { podcastId: podcast.id, tagId: tag.id },
          });
        }
      }

      totalTagsAdded += tags.length;
    }

    console.log(
      `\n${dryRun ? 'Would tag' : 'Tagged'} ${podcastsTagged} podcasts with ${totalTagsAdded} topic tags.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
