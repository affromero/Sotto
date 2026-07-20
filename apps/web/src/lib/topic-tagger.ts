/**
 * Keyword-based topic tag matcher.
 * Maps episode topics + focus areas to existing tag slugs from the seed data.
 * Pure keyword matching — no AI calls, deterministic, free.
 */

/** Keyword lists for each tag slug. Longer keywords are scored higher. */
// prettier-ignore
const TAG_KEYWORDS: Record<string, string[]> = {
  // Top-level categories
  technology: ['technology', 'tech', 'software', 'hardware', 'computing', 'digital', 'internet'],
  science: ['science', 'scientific', 'research', 'experiment', 'laboratory', 'discovery'],
  business: ['business', 'company', 'corporate', 'enterprise', 'industry', 'commerce'],
  history: ['history', 'historical', 'ancient', 'medieval', 'century', 'era', 'civilization'],
  philosophy: ['philosophy', 'philosophical', 'metaphysics', 'epistemology', 'ontology'],
  health: ['health', 'medical', 'medicine', 'wellness', 'healthcare', 'clinical', 'therapy'],
  'ai-ml': [
    'artificial intelligence',
    'machine learning',
    'deep learning',
    'ai',
    'ml',
    'natural language processing',
    'nlp',
    'transformer',
    'generative ai',
  ],
  programming: ['programming', 'coding', 'software development', 'developer', 'code', 'engineer'],
  mathematics: ['mathematics', 'math', 'mathematical', 'theorem', 'equation', 'algebra', 'calculus'],
  psychology: ['psychology', 'psychological', 'cognitive', 'behavior', 'behavioural', 'mental'],
  economics: ['economics', 'economy', 'economic', 'fiscal', 'gdp', 'inflation', 'recession'],
  'art-design': ['art', 'design', 'creative', 'aesthetic', 'visual', 'illustration'],
  music: ['music', 'musical', 'musician', 'song', 'melody', 'rhythm', 'instrument', 'album'],
  'politics-society': ['politics', 'political', 'government', 'democracy', 'policy', 'society', 'social'],
  environment: ['environment', 'environmental', 'ecology', 'ecosystem', 'green', 'sustainability'],
  'language-literature': ['literature', 'literary', 'novel', 'fiction', 'author', 'writing', 'book'],
  'sports-fitness': ['sports', 'sport', 'fitness', 'athletic', 'athlete', 'training', 'exercise'],
  education: ['education', 'educational', 'learning', 'teaching', 'school', 'university', 'academic'],

  // Technology sub-interests
  'quantum-computing': ['quantum computing', 'quantum computer', 'qubit', 'quantum supremacy', 'quantum'],
  cybersecurity: [
    'cybersecurity',
    'cyber security',
    'hacking',
    'malware',
    'ransomware',
    'infosec',
    'security vulnerability',
  ],
  blockchain: ['blockchain', 'cryptocurrency', 'crypto', 'bitcoin', 'ethereum', 'web3', 'defi', 'nft'],
  robotics: ['robotics', 'robot', 'autonomous', 'automation', 'mechatronics'],
  'space-tech': ['space technology', 'spacex', 'nasa', 'satellite', 'rocket', 'space exploration', 'orbital'],
  semiconductors: ['semiconductor', 'chip', 'transistor', 'silicon', 'fabrication', 'tsmc', 'intel', 'cpu', 'gpu'],
  'ar-vr': ['augmented reality', 'virtual reality', 'ar', 'vr', 'mixed reality', 'metaverse', 'xr'],

  // Science sub-interests
  neuroscience: ['neuroscience', 'neuron', 'brain', 'neural', 'cortex', 'synapse', 'neurological'],
  'climate-science': ['climate science', 'climate model', 'atmospheric', 'greenhouse', 'global warming'],
  genetics: ['genetics', 'genetic', 'dna', 'genome', 'gene editing', 'crispr', 'hereditary', 'mutation'],
  astrophysics: ['astrophysics', 'cosmology', 'universe', 'galaxy', 'star', 'black hole', 'dark matter', 'dark energy'],
  'marine-biology': ['marine biology', 'ocean life', 'coral reef', 'marine ecosystem', 'aquatic'],
  'materials-science': ['materials science', 'nanomaterial', 'polymer', 'composite', 'superconductor', 'alloy'],

  // Business sub-interests
  startups: ['startup', 'startups', 'founder', 'bootstrapping', 'seed funding', 'unicorn', 'ycombinator'],
  leadership: ['leadership', 'leader', 'management', 'ceo', 'executive', 'organizational'],
  'product-management': ['product management', 'product manager', 'roadmap', 'user story', 'backlog', 'agile', 'scrum'],
  'venture-capital': ['venture capital', 'vc', 'angel investor', 'funding round', 'series a', 'series b', 'valuation'],
  'marketing-strategy': ['marketing', 'branding', 'growth hacking', 'seo', 'content marketing', 'market strategy'],
  'supply-chain': ['supply chain', 'logistics', 'procurement', 'warehouse', 'inventory', 'distribution'],

  // History sub-interests
  'ancient-civilizations': [
    'ancient civilization',
    'ancient rome',
    'ancient greece',
    'ancient egypt',
    'mesopotamia',
    'pharaoh',
  ],
  'world-wars': ['world war', 'wwi', 'wwii', 'ww2', 'ww1', 'nazi', 'allied forces', 'pearl harbor', 'normandy'],
  'cold-war': ['cold war', 'soviet union', 'ussr', 'iron curtain', 'cuban missile', 'nuclear arms race'],
  'medieval-history': ['medieval', 'middle ages', 'feudal', 'crusade', 'knight', 'castle', 'renaissance'],
  'history-of-science': ['history of science', 'scientific revolution', 'enlightenment', 'newton', 'galileo', 'darwin'],
  'colonial-history': ['colonial', 'colonialism', 'imperialism', 'decolonization', 'empire'],

  // Philosophy sub-interests
  ethics: ['ethics', 'ethical', 'morality', 'moral', 'bioethics', 'deontology', 'utilitarianism'],
  existentialism: ['existentialism', 'existential', 'sartre', 'kierkegaard', 'absurdism', 'camus', 'nietzsche'],
  'philosophy-of-mind': ['philosophy of mind', 'consciousness', 'qualia', 'mind-body', 'dualism', 'free will'],
  'political-philosophy': ['political philosophy', 'social contract', 'justice', 'rawls', 'libertarianism', 'marxism'],
  'eastern-philosophy': ['eastern philosophy', 'buddhism', 'taoism', 'zen', 'confucianism', 'hinduism', 'vedanta'],
  logic: ['formal logic', 'logical', 'syllogism', 'propositional logic', 'predicate logic', 'boolean'],

  // Health sub-interests
  nutrition: ['nutrition', 'diet', 'vitamin', 'macronutrient', 'calorie', 'protein', 'carbohydrate', 'food science'],
  'mental-health': ['mental health', 'depression', 'anxiety', 'ptsd', 'adhd', 'psychotherapy', 'counseling'],
  'sleep-science': ['sleep science', 'circadian', 'insomnia', 'rem sleep', 'melatonin', 'sleep quality'],
  'exercise-science': ['exercise science', 'kinesiology', 'strength training', 'cardio', 'aerobic', 'anaerobic'],
  longevity: ['longevity', 'aging', 'anti-aging', 'lifespan', 'telomere', 'senescence', 'gerontology'],
  epidemiology: [
    'epidemiology',
    'pandemic',
    'epidemic',
    'infectious disease',
    'pathogen',
    'vaccination',
    'public health',
  ],

  // AI & ML sub-interests
  'large-language-models': [
    'large language model',
    'llm',
    'gpt',
    'claude',
    'chatgpt',
    'gemini',
    'llama',
    'language model',
  ],
  'computer-vision': ['computer vision', 'image recognition', 'object detection', 'image classification', 'opencv'],
  'reinforcement-learning': [
    'reinforcement learning',
    'rl',
    'reward function',
    'q-learning',
    'policy gradient',
    'alphago',
  ],
  'ai-ethics': ['ai ethics', 'ai bias', 'algorithmic fairness', 'ai safety', 'ai alignment', 'responsible ai'],
  'neural-networks': ['neural network', 'cnn', 'rnn', 'lstm', 'attention mechanism', 'backpropagation', 'perceptron'],
  'ai-in-healthcare': ['ai in healthcare', 'medical ai', 'diagnostic ai', 'clinical ai', 'ai diagnosis'],

  // Programming sub-interests
  'web-development': [
    'web development',
    'web dev',
    'frontend',
    'backend',
    'fullstack',
    'javascript',
    'typescript',
    'react',
    'next.js',
  ],
  'systems-programming': [
    'systems programming',
    'operating system',
    'kernel',
    'low-level',
    'rust',
    'c++',
    'assembly',
    'memory management',
  ],
  devops: ['devops', 'ci/cd', 'kubernetes', 'docker', 'infrastructure', 'deployment', 'terraform', 'ansible'],
  'functional-programming': [
    'functional programming',
    'haskell',
    'erlang',
    'elixir',
    'immutability',
    'lambda',
    'monad',
    'pure function',
  ],
  'game-development': [
    'game development',
    'game dev',
    'game engine',
    'unity',
    'unreal engine',
    'game design',
    'indie game',
  ],
  'open-source': ['open source', 'oss', 'open-source', 'github', 'free software', 'linux', 'foss', 'gnu'],

  // Mathematics sub-interests
  statistics: ['statistics', 'statistical', 'probability', 'bayesian', 'regression', 'hypothesis testing', 'p-value'],
  'number-theory': ['number theory', 'prime number', 'riemann', 'modular arithmetic', 'diophantine'],
  cryptography: [
    'cryptography',
    'encryption',
    'cipher',
    'rsa',
    'elliptic curve',
    'zero knowledge proof',
    'hash function',
  ],
  'game-theory': ['game theory', 'nash equilibrium', 'prisoner dilemma', 'minimax', 'strategic interaction'],
  topology: ['topology', 'topological', 'manifold', 'homeomorphism', 'knot theory'],
  'applied-mathematics': [
    'applied mathematics',
    'numerical analysis',
    'optimization',
    'linear algebra',
    'differential equation',
  ],

  // Psychology sub-interests
  'cognitive-biases': [
    'cognitive bias',
    'confirmation bias',
    'anchoring',
    'dunning-kruger',
    'heuristic',
    'framing effect',
  ],
  'behavioral-economics': ['behavioral economics', 'nudge', 'prospect theory', 'kahneman', 'tversky', 'loss aversion'],
  'developmental-psychology': [
    'developmental psychology',
    'child development',
    'piaget',
    'attachment theory',
    'adolescent',
  ],
  'social-psychology': ['social psychology', 'conformity', 'obedience', 'groupthink', 'bystander effect', 'milgram'],
  neuropsychology: ['neuropsychology', 'brain injury', 'aphasia', 'neuroplasticity', 'cognitive rehabilitation'],
  'positive-psychology': [
    'positive psychology',
    'well-being',
    'flourishing',
    'resilience',
    'gratitude',
    'flow state',
    'happiness',
  ],

  // Economics sub-interests
  macroeconomics: ['macroeconomics', 'gdp growth', 'unemployment rate', 'aggregate demand', 'fiscal policy'],
  microeconomics: ['microeconomics', 'supply and demand', 'market structure', 'price elasticity', 'consumer surplus'],
  'international-trade': [
    'international trade',
    'tariff',
    'trade agreement',
    'wto',
    'free trade',
    'protectionism',
    'export',
  ],
  'monetary-policy': [
    'monetary policy',
    'central bank',
    'interest rate',
    'federal reserve',
    'quantitative easing',
    'inflation targeting',
  ],
  'labor-economics': ['labor economics', 'wage', 'minimum wage', 'labor market', 'unionization', 'gig economy'],
  'development-economics': [
    'development economics',
    'poverty',
    'developing country',
    'microfinance',
    'foreign aid',
    'inequality',
  ],

  // Art & Design sub-interests
  'ui-ux-design': [
    'ui design',
    'ux design',
    'user interface',
    'user experience',
    'usability',
    'wireframe',
    'prototype',
  ],
  typography: ['typography', 'typeface', 'font', 'lettering', 'kerning', 'serif', 'sans-serif'],
  architecture: [
    'architecture',
    'architect',
    'building design',
    'urban design',
    'zaha hadid',
    'brutalism',
    'modernist',
  ],
  'digital-art': ['digital art', 'pixel art', 'generative art', '3d modeling', 'procedural', 'nft art'],
  'art-history': ['art history', 'impressionism', 'cubism', 'surrealism', 'baroque', 'renaissance art'],
  'graphic-design': ['graphic design', 'logo', 'branding design', 'poster', 'layout', 'composition', 'color theory'],

  // Music sub-interests
  'music-theory': [
    'music theory',
    'harmony',
    'counterpoint',
    'chord progression',
    'scale',
    'key signature',
    'time signature',
  ],
  jazz: ['jazz', 'bebop', 'swing', 'improvisation', 'miles davis', 'john coltrane', 'jazz fusion'],
  'classical-music': ['classical music', 'orchestra', 'symphony', 'concerto', 'beethoven', 'mozart', 'bach', 'opera'],
  'music-production': ['music production', 'mixing', 'mastering', 'daw', 'ableton', 'synthesizer', 'sampling'],
  'hip-hop-culture': ['hip hop', 'rap', 'hip-hop', 'mc', 'turntablism', 'beatmaking', 'freestyle'],
  'world-music': ['world music', 'folk music', 'ethnomusicology', 'gamelan', 'flamenco', 'afrobeat'],
  'electronic-music': ['electronic music', 'techno', 'house music', 'edm', 'ambient', 'drum and bass', 'synth'],

  // Politics & Society sub-interests
  geopolitics: ['geopolitics', 'geopolitical', 'international relations', 'superpower', 'diplomacy', 'nato'],
  'human-rights': ['human rights', 'civil rights', 'civil liberties', 'freedom', 'equality', 'discrimination'],
  'urban-planning': ['urban planning', 'city planning', 'zoning', 'public transit', 'walkability', 'gentrification'],
  immigration: ['immigration', 'immigrant', 'refugee', 'asylum', 'migration', 'border', 'visa'],
  'media-journalism': ['media', 'journalism', 'press', 'news media', 'investigative journalism', 'disinformation'],
  'social-movements': ['social movement', 'protest', 'activism', 'grassroots', 'civil disobedience'],
  'public-policy': ['public policy', 'regulation', 'legislation', 'governance', 'bureaucracy', 'reform'],

  // Environment sub-interests
  'climate-change': [
    'climate change',
    'global warming',
    'carbon emission',
    'carbon footprint',
    'paris agreement',
    'net zero',
  ],
  'renewable-energy': ['renewable energy', 'solar power', 'wind power', 'hydropower', 'geothermal', 'clean energy'],
  conservation: [
    'conservation',
    'wildlife conservation',
    'endangered species',
    'habitat',
    'national park',
    'rewilding',
  ],
  'sustainable-agriculture': [
    'sustainable agriculture',
    'organic farming',
    'permaculture',
    'regenerative',
    'food system',
  ],
  'ocean-science': ['ocean science', 'oceanography', 'deep sea', 'ocean current', 'marine pollution', 'overfishing'],
  biodiversity: ['biodiversity', 'species diversity', 'extinction', 'invasive species', 'pollinator'],

  // Language & Literature sub-interests
  'creative-writing': ['creative writing', 'fiction writing', 'narrative', 'short story', 'screenplay'],
  poetry: ['poetry', 'poem', 'poet', 'verse', 'sonnet', 'haiku', 'spoken word'],
  'science-fiction': ['science fiction', 'sci-fi', 'speculative fiction', 'dystopia', 'cyberpunk', 'space opera'],
  linguistics: [
    'linguistics',
    'language',
    'syntax',
    'phonology',
    'morphology',
    'semantics',
    'pragmatics',
    'sociolinguistics',
  ],
  'world-literature': ['world literature', 'comparative literature', 'translation', 'literary canon'],
  storytelling: ['storytelling', 'narrative structure', 'story arc', 'character development', 'plot'],

  // Sports & Fitness sub-interests
  'sports-analytics': ['sports analytics', 'sabermetrics', 'moneyball', 'player tracking', 'sports data'],
  'olympic-sports': ['olympics', 'olympic', 'gold medal', 'olympic games', 'winter olympics', 'summer olympics'],
  'martial-arts': ['martial arts', 'karate', 'judo', 'taekwondo', 'mma', 'ufc', 'boxing', 'jiu-jitsu', 'kung fu'],
  'endurance-training': ['endurance training', 'marathon', 'triathlon', 'ultramarathon', 'cycling', 'running'],
  'sports-psychology': [
    'sports psychology',
    'mental toughness',
    'peak performance',
    'athlete mindset',
    'visualization',
  ],
  biomechanics: ['biomechanics', 'gait analysis', 'motion capture', 'kinematics', 'muscle activation'],

  // Education sub-interests
  pedagogy: ['pedagogy', 'teaching method', 'didactic', 'curriculum', 'instructional design', 'bloom taxonomy'],
  edtech: ['edtech', 'educational technology', 'e-learning', 'online learning', 'mooc', 'lms'],
  homeschooling: ['homeschooling', 'homeschool', 'home education', 'unschooling'],
  'higher-education': ['higher education', 'college', 'university', 'graduate school', 'phd', 'academia', 'tenure'],
  'learning-science': [
    'learning science',
    'spaced repetition',
    'retrieval practice',
    'metacognition',
    'cognitive load',
  ],
  'stem-education': ['stem education', 'stem', 'science education', 'math education', 'engineering education'],
};

/** Maps sub-interest slugs to their parent category slug. */
const TAG_PARENT_MAP: Record<string, string> = {
  // Technology
  'quantum-computing': 'technology',
  cybersecurity: 'technology',
  blockchain: 'technology',
  robotics: 'technology',
  'space-tech': 'technology',
  semiconductors: 'technology',
  'ar-vr': 'technology',
  // Science
  neuroscience: 'science',
  'climate-science': 'science',
  genetics: 'science',
  astrophysics: 'science',
  'marine-biology': 'science',
  'materials-science': 'science',
  // Business
  startups: 'business',
  leadership: 'business',
  'product-management': 'business',
  'venture-capital': 'business',
  'marketing-strategy': 'business',
  'supply-chain': 'business',
  // History
  'ancient-civilizations': 'history',
  'world-wars': 'history',
  'cold-war': 'history',
  'medieval-history': 'history',
  'history-of-science': 'history',
  'colonial-history': 'history',
  // Philosophy
  ethics: 'philosophy',
  existentialism: 'philosophy',
  'philosophy-of-mind': 'philosophy',
  'political-philosophy': 'philosophy',
  'eastern-philosophy': 'philosophy',
  logic: 'philosophy',
  // Health
  nutrition: 'health',
  'mental-health': 'health',
  'sleep-science': 'health',
  'exercise-science': 'health',
  longevity: 'health',
  epidemiology: 'health',
  // AI & ML
  'large-language-models': 'ai-ml',
  'computer-vision': 'ai-ml',
  'reinforcement-learning': 'ai-ml',
  'ai-ethics': 'ai-ml',
  'neural-networks': 'ai-ml',
  'ai-in-healthcare': 'ai-ml',
  // Programming
  'web-development': 'programming',
  'systems-programming': 'programming',
  devops: 'programming',
  'functional-programming': 'programming',
  'game-development': 'programming',
  'open-source': 'programming',
  // Mathematics
  statistics: 'mathematics',
  'number-theory': 'mathematics',
  cryptography: 'mathematics',
  'game-theory': 'mathematics',
  topology: 'mathematics',
  'applied-mathematics': 'mathematics',
  // Psychology
  'cognitive-biases': 'psychology',
  'behavioral-economics': 'psychology',
  'developmental-psychology': 'psychology',
  'social-psychology': 'psychology',
  neuropsychology: 'psychology',
  'positive-psychology': 'psychology',
  // Economics
  macroeconomics: 'economics',
  microeconomics: 'economics',
  'international-trade': 'economics',
  'monetary-policy': 'economics',
  'labor-economics': 'economics',
  'development-economics': 'economics',
  // Art & Design
  'ui-ux-design': 'art-design',
  typography: 'art-design',
  architecture: 'art-design',
  'digital-art': 'art-design',
  'art-history': 'art-design',
  'graphic-design': 'art-design',
  // Music
  'music-theory': 'music',
  jazz: 'music',
  'classical-music': 'music',
  'music-production': 'music',
  'hip-hop-culture': 'music',
  'world-music': 'music',
  'electronic-music': 'music',
  // Politics & Society
  geopolitics: 'politics-society',
  'human-rights': 'politics-society',
  'urban-planning': 'politics-society',
  immigration: 'politics-society',
  'media-journalism': 'politics-society',
  'social-movements': 'politics-society',
  'public-policy': 'politics-society',
  // Environment
  'climate-change': 'environment',
  'renewable-energy': 'environment',
  conservation: 'environment',
  'sustainable-agriculture': 'environment',
  'ocean-science': 'environment',
  biodiversity: 'environment',
  // Language & Literature
  'creative-writing': 'language-literature',
  poetry: 'language-literature',
  'science-fiction': 'language-literature',
  linguistics: 'language-literature',
  'world-literature': 'language-literature',
  storytelling: 'language-literature',
  // Sports & Fitness
  'sports-analytics': 'sports-fitness',
  'olympic-sports': 'sports-fitness',
  'martial-arts': 'sports-fitness',
  'endurance-training': 'sports-fitness',
  'sports-psychology': 'sports-fitness',
  biomechanics: 'sports-fitness',
  // Education
  pedagogy: 'education',
  edtech: 'education',
  homeschooling: 'education',
  'higher-education': 'education',
  'learning-science': 'education',
  'stem-education': 'education',
};

interface MatchTopicTagsInput {
  topic: string;
  focusAreas: string[];
  maxTags?: number;
}

/**
 * Check if a keyword appears in text as a whole word/phrase.
 * Uses word boundary matching to avoid false positives (e.g. "foss" in "fossil").
 * Allows optional trailing "s" to handle plurals (e.g. "neural network" matches "neural networks").
 */
function keywordMatches(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}s?\\b`, 'i');
  return re.test(text);
}

/**
 * Match episode topic + focus areas to tag slugs using keyword matching.
 * Returns tag slugs sorted by relevance (best match first), including parent categories.
 */
export function matchTopicTags({ topic, focusAreas, maxTags = 5 }: MatchTopicTagsInput): string[] {
  const text = [topic, ...focusAreas].join(' ').toLowerCase();
  if (!text.trim()) return [];

  const scores = new Map<string, number>();

  for (const [slug, keywords] of Object.entries(TAG_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (keywordMatches(text, keyword)) {
        // Longer keyword matches are more specific and score higher
        score += keyword.length;
      }
    }
    if (score > 0) {
      scores.set(slug, score);
    }
  }

  // Sort by score descending, take top N sub-interest tags (skip top-level categories for ranking)
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);

  // Collect final slugs: top N matches + their parent categories
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

export { TAG_PARENT_MAP };
