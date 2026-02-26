/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding demo data...');

  // ── 1. Demo user (CREATOR) ──────────────────────────────────────
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@sotto.fm' },
    update: {
      name: 'Nico Valerio',
      role: 'CREATOR',
      bio: 'Curious mind, lifelong learner. I make podcasts about the things that keep me up at night — from quantum mechanics to ancient philosophy.',
      image: 'https://ui-avatars.com/api/?name=K+B&background=D97706&color=fff&size=256&bold=true&format=png',
    },
    create: {
      email: 'demo@sotto.fm',
      name: 'Nico Valerio',
      role: 'CREATOR',
      bio: 'Curious mind, lifelong learner. I make podcasts about the things that keep me up at night — from quantum mechanics to ancient philosophy.',
      image: 'https://ui-avatars.com/api/?name=K+B&background=D97706&color=fff&size=256&bold=true&format=png',
    },
  });
  console.log(`  Demo user: ${demoUser.id} (${demoUser.email})`);

  // ── 2. Admin user ───────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@sotto.fm' },
    update: { name: 'Sotto Admin', role: 'ADMIN' },
    create: {
      email: 'admin@sotto.fm',
      name: 'Sotto Admin',
      role: 'ADMIN',
      image: 'https://api.dicebear.com/9.x/notionists/svg?seed=admin&backgroundColor=1E3A5F',
    },
  });
  console.log(`  Admin user: ${adminUser.id} (${adminUser.email})`);

  // ── 3. Additional users (varied tiers & roles) ─────────────────
  const extraUsers = [
    {
      email: 'maria.chen@example.com',
      name: 'Maria Chen',
      role: 'CREATOR' as const,
      seed: 'maria',
    },
    {
      email: 'james.okafor@example.com',
      name: 'James Okafor',
      role: 'CREATOR' as const,
      seed: 'james',
    },
    {
      email: 'sofia.petrov@example.com',
      name: 'Sofia Petrov',
      role: 'USER' as const,
      seed: 'sofia',
    },
    { email: 'liam.tanaka@example.com', name: 'Liam Tanaka', role: 'USER' as const, seed: 'liam' },
    {
      email: 'priya.sharma@example.com',
      name: 'Priya Sharma',
      role: 'CREATOR' as const,
      seed: 'priya',
    },
    { email: 'noah.weber@example.com', name: 'Noah Weber', role: 'USER' as const, seed: 'noah' },
    { email: 'elena.rossi@example.com', name: 'Elena Rossi', role: 'USER' as const, seed: 'elena' },
    {
      email: 'omar.hassan@example.com',
      name: 'Omar Hassan',
      role: 'CREATOR' as const,
      seed: 'omar',
    },
    {
      email: 'chloe.dubois@example.com',
      name: 'Chloe Dubois',
      role: 'USER' as const,
      seed: 'chloe',
    },
    { email: 'kai.nakamura@example.com', name: 'Kai Nakamura', role: 'USER' as const, seed: 'kai' },
  ];

  const createdUsers = [];
  for (const u of extraUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        image: `https://api.dicebear.com/9.x/notionists/svg?seed=${u.seed}`,
      },
    });
    createdUsers.push(user);
  }
  console.log(`  Created ${createdUsers.length} additional users`);

  // ── 4. Ensure tags exist (reuse from seed.ts) ──────────────────
  const tagSlugs = [
    'technology',
    'science',
    'business',
    'history',
    'philosophy',
    'health',
    'ai-ml',
    'programming',
  ];
  const tagMap: Record<string, string> = {};
  for (const slug of tagSlugs) {
    const tag = await prisma.tag.findUnique({ where: { slug } });
    if (tag) tagMap[slug] = tag.id;
  }

  // ── 6. Podcasts ─────────────────────────────────────────────────
  const podcastDefs = [
    {
      title: 'The Hidden History of Cryptography',
      topic:
        'From ancient ciphers to modern encryption — how secret codes shaped wars, commerce, and the digital age.',
      visibility: 'PUBLIC' as const,
      playCount: 500,
      likeCount: 42,
      forkCount: 3,
      tags: ['history', 'technology'],
      userId: demoUser.id,
    },
    {
      title: 'Understanding Quantum Computing',
      topic:
        'Qubits, superposition, and entanglement explained for curious minds. What quantum computers can (and cannot) do today.',
      visibility: 'PUBLIC' as const,
      playCount: 320,
      likeCount: 28,
      forkCount: 1,
      tags: ['science', 'technology'],
      userId: demoUser.id,
    },
    {
      title: 'The Future of Remote Work',
      topic:
        'How distributed teams, async communication, and AI tools are reshaping the way we work — and what it means for cities, culture, and careers.',
      visibility: 'PUBLIC' as const,
      playCount: 210,
      likeCount: 19,
      forkCount: 0,
      tags: ['business', 'technology'],
      userId: demoUser.id,
    },
    {
      title: 'AI Ethics: Where Do We Draw the Line?',
      topic:
        'Bias in models, deepfakes, autonomous weapons, surveillance — the ethical dilemmas of artificial intelligence and who gets to decide.',
      visibility: 'PUBLIC' as const,
      playCount: 180,
      likeCount: 15,
      forkCount: 2,
      tags: ['ai-ml', 'philosophy'],
      userId: demoUser.id,
    },
    {
      title: 'Stoicism for Modern Life',
      topic:
        'Marcus Aurelius, Seneca, and Epictetus — how ancient Stoic philosophy offers practical wisdom for dealing with stress, uncertainty, and ambition today.',
      visibility: 'PUBLIC' as const,
      playCount: 150,
      likeCount: 12,
      forkCount: 1,
      tags: ['philosophy', 'health'],
      userId: demoUser.id,
    },
    {
      title: 'How mRNA Vaccines Work',
      topic:
        'The science behind mRNA vaccine technology, from basic cell biology to the Pfizer and Moderna COVID-19 vaccines. How they were developed so quickly and what comes next.',
      visibility: 'PRIVATE' as const,
      playCount: 0,
      likeCount: 0,
      forkCount: 0,
      tags: ['science', 'health'],
      userId: demoUser.id,
    },
  ];

  // Segment templates — realistic two-voice podcast dialogue
  const segmentSets: { speaker: string; text: string }[][] = [
    // Cryptography
    [
      {
        speaker: 'HOST',
        text: "Welcome back to Sotto. Today we're diving into something that's been a part of human civilization for thousands of years — cryptography. The art and science of secret communication.",
      },
      {
        speaker: 'EXPERT',
        text: "That's right. And what's fascinating is that the basic challenge hasn't changed since ancient times: how do you send a message that only the intended recipient can read?",
      },
      {
        speaker: 'HOST',
        text: "Let's start at the very beginning. When did humans first start encrypting messages?",
      },
      {
        speaker: 'EXPERT',
        text: 'The earliest known use dates back to around 1900 BC in ancient Egypt. But the first well-documented cipher is the Caesar cipher, used by Julius Caesar to communicate with his generals.',
      },
      { speaker: 'HOST', text: 'The one where you shift each letter by a fixed number?' },
      {
        speaker: 'EXPERT',
        text: "Exactly. Caesar used a shift of three. So 'A' becomes 'D', 'B' becomes 'E', and so on. Simple by today's standards, but revolutionary at the time.",
      },
      {
        speaker: 'HOST',
        text: "Fast forward to World War II — that's when things really got interesting with the Enigma machine.",
      },
      {
        speaker: 'EXPERT',
        text: 'The Enigma machine was an electro-mechanical device used by Nazi Germany. It created a cipher so complex that the Germans believed it was unbreakable. Each day, operators would set the machine to a new configuration.',
      },
      { speaker: 'HOST', text: 'And then Alan Turing and the team at Bletchley Park cracked it.' },
      {
        speaker: 'EXPERT',
        text: "They did. Turing built the Bombe machine, which could test thousands of possible Enigma settings. It's estimated that breaking Enigma shortened the war by about two years and saved millions of lives.",
      },
      {
        speaker: 'HOST',
        text: 'That brings us to the modern era. How does encryption work today?',
      },
      {
        speaker: 'EXPERT',
        text: 'Modern encryption relies on mathematical problems that are easy to compute in one direction but practically impossible to reverse. RSA encryption, for example, is based on the difficulty of factoring very large prime numbers.',
      },
    ],
    // Quantum Computing
    [
      {
        speaker: 'HOST',
        text: "Today on Sotto, we're tackling one of the most mind-bending topics in modern science — quantum computing. What makes it so different from the computers we use every day?",
      },
      {
        speaker: 'EXPERT',
        text: 'Great question. Classical computers process information using bits — zeros and ones. A quantum computer uses qubits, which can exist in a superposition of both zero and one simultaneously.',
      },
      {
        speaker: 'HOST',
        text: 'That sounds almost magical. How does superposition actually work?',
      },
      {
        speaker: 'EXPERT',
        text: "Think of a coin spinning in the air. While it's spinning, it's neither heads nor tails — it has some probability of being either. A qubit in superposition is similar. It holds both possibilities until you measure it.",
      },
      {
        speaker: 'HOST',
        text: "And then there's entanglement — Einstein called it 'spooky action at a distance.'",
      },
      {
        speaker: 'EXPERT',
        text: "Entanglement is when two qubits become correlated in such a way that measuring one instantly tells you about the other, no matter how far apart they are. This isn't communication — it's correlation.",
      },
      {
        speaker: 'HOST',
        text: "So what can quantum computers actually do that classical computers can't?",
      },
      {
        speaker: 'EXPERT',
        text: "They excel at specific problems. Shor's algorithm can factor large numbers exponentially faster — which would break RSA encryption. Grover's algorithm provides quadratic speedup for searching unsorted databases.",
      },
      { speaker: 'HOST', text: "That sounds like it could break the internet's security." },
      {
        speaker: 'EXPERT',
        text: "Potentially, yes. That's why there's a whole field called post-quantum cryptography developing encryption methods that are resistant to quantum attacks. NIST has already standardized several post-quantum algorithms.",
      },
    ],
    // Remote Work
    [
      {
        speaker: 'HOST',
        text: "The way we work has fundamentally changed. Today on Sotto, we're exploring the future of remote work and what it means for all of us.",
      },
      {
        speaker: 'EXPERT',
        text: "The pandemic was really a forcing function. Companies that said remote work was impossible suddenly had their entire workforce operating from home — and discovered that productivity didn't collapse.",
      },
      { speaker: 'HOST', text: "But it's not all rosy, is it? There are real challenges." },
      {
        speaker: 'EXPERT',
        text: 'Absolutely. Loneliness, burnout, the blurring of work-life boundaries. And there are significant challenges around mentorship, spontaneous collaboration, and building company culture remotely.',
      },
      {
        speaker: 'HOST',
        text: 'How are the most successful remote companies handling these challenges?',
      },
      {
        speaker: 'EXPERT',
        text: "The best remote companies are 'async-first' — they default to written communication, recorded video updates, and documented decisions. This means meetings are intentional rather than habitual.",
      },
      { speaker: 'HOST', text: "What about AI's role in all of this?" },
      {
        speaker: 'EXPERT',
        text: 'AI is becoming a game-changer for remote work. AI meeting summaries, automated task management, code review assistants — these tools reduce the coordination cost that makes remote work harder.',
      },
      { speaker: 'HOST', text: 'Where do you see this heading in the next five to ten years?' },
      {
        speaker: 'EXPERT',
        text: "I think we'll see a spectrum. Some work will be fully remote, some hybrid, some in-person. The key shift is that location will be a choice, not a requirement, for most knowledge workers.",
      },
    ],
    // AI Ethics
    [
      {
        speaker: 'HOST',
        text: "Artificial intelligence is advancing at a breathtaking pace. But today on Sotto, we're asking the harder question — where should we draw the ethical lines?",
      },
      {
        speaker: 'EXPERT',
        text: 'This is the defining challenge of our generation. The technology itself is neutral, but the way we deploy it reflects our values — or lack thereof.',
      },
      { speaker: 'HOST', text: "Let's start with bias. How do AI systems become biased?" },
      {
        speaker: 'EXPERT',
        text: 'AI systems learn from data, and data reflects historical human decisions. If you train a hiring algorithm on decades of biased hiring data, the algorithm will perpetuate and even amplify those biases.',
      },
      {
        speaker: 'HOST',
        text: "What about deepfakes? That's something that worries a lot of people.",
      },
      {
        speaker: 'EXPERT',
        text: "Deepfakes are a real concern. We're reaching a point where you genuinely cannot tell a real video from a generated one. This undermines trust in media and creates new vectors for fraud and manipulation.",
      },
      { speaker: 'HOST', text: "And then there's the question of autonomous weapons." },
      {
        speaker: 'EXPERT',
        text: 'This is perhaps the most urgent ethical question. Should a machine be able to make life-or-death decisions without human intervention? Most ethicists say no, but the military incentives are strong.',
      },
      { speaker: 'HOST', text: 'Who gets to decide these ethical boundaries?' },
      {
        speaker: 'EXPERT',
        text: "That's the trillion-dollar question. Right now it's a patchwork — some regulation from governments, some self-regulation from companies, and a lot of academic debate. We need more inclusive, democratic processes for these decisions.",
      },
      { speaker: 'HOST', text: 'What gives you hope?' },
      {
        speaker: 'EXPERT',
        text: "The fact that we're having this conversation. Awareness is the first step. And I see a growing movement of responsible AI practitioners who are building ethical considerations into the development process from the start.",
      },
    ],
    // Stoicism
    [
      {
        speaker: 'HOST',
        text: "Today on Sotto, we're going back over two thousand years to explore a philosophy that's having a massive renaissance — Stoicism.",
      },
      {
        speaker: 'EXPERT',
        text: "It's remarkable how relevant Stoic ideas are today. The core insight is simple but powerful: we can't control what happens to us, but we can control how we respond.",
      },
      { speaker: 'HOST', text: 'Who were the major Stoic philosophers?' },
      {
        speaker: 'EXPERT',
        text: 'Three stand out. Seneca was a Roman statesman and playwright. Epictetus was a former slave who became one of the most respected teachers in Rome. And Marcus Aurelius was literally the Emperor of Rome.',
      },
      { speaker: 'HOST', text: "An emperor, a slave, and a senator — that's quite a range." },
      {
        speaker: 'EXPERT',
        text: "And that's what makes Stoicism universal. It works regardless of your circumstances. Marcus Aurelius wrote his Meditations as a private journal — never intending it for publication — while managing the Roman Empire.",
      },
      { speaker: 'HOST', text: 'How can someone apply Stoic principles to modern life?' },
      {
        speaker: 'EXPERT',
        text: "Start with the dichotomy of control. Every morning, identify what's in your control — your effort, your attitude, your responses — and what isn't — other people's opinions, the economy, the weather. Focus your energy only on the first category.",
      },
      {
        speaker: 'HOST',
        text: "What about negative visualization? That's a practice I've heard about.",
      },
      {
        speaker: 'EXPERT',
        text: "Yes — premeditatio malorum. Deliberately imagining worst-case scenarios. Not to be pessimistic, but to reduce anxiety. When you've mentally rehearsed losing something, you appreciate it more and fear less.",
      },
    ],
    // mRNA Vaccines
    [
      {
        speaker: 'HOST',
        text: "The COVID-19 pandemic brought a technology into the spotlight that most people had never heard of — mRNA vaccines. Today on Sotto, we're breaking down how they actually work.",
      },
      {
        speaker: 'EXPERT',
        text: 'mRNA vaccines represent a fundamentally different approach to vaccination. Instead of injecting a weakened or inactivated virus, you inject instructions — messenger RNA — that tell your cells to make a harmless piece of the virus.',
      },
      { speaker: 'HOST', text: 'So your body becomes the factory?' },
      {
        speaker: 'EXPERT',
        text: 'Exactly. Your cells read the mRNA instructions, produce the spike protein found on the surface of the coronavirus, and then your immune system recognizes it as foreign and mounts a response.',
      },
      { speaker: 'HOST', text: 'How were the Pfizer and Moderna vaccines developed so quickly?' },
      {
        speaker: 'EXPERT',
        text: "The technology had been in development for over a decade. Katalin Karik and Drew Weissman solved the key problem — making synthetic mRNA that doesn't trigger an inflammatory response — back in 2005. When COVID hit, the platform was ready.",
      },
      { speaker: 'HOST', text: 'Does the mRNA change your DNA?' },
      {
        speaker: 'EXPERT',
        text: "No, absolutely not. mRNA never enters the cell nucleus where DNA is stored. It stays in the cytoplasm, gets read by ribosomes to make proteins, and then it's broken down naturally within hours to days.",
      },
      { speaker: 'HOST', text: "What's next for mRNA technology?" },
      {
        speaker: 'EXPERT',
        text: "The potential is enormous. There are clinical trials for mRNA vaccines against cancer, HIV, malaria, and even autoimmune diseases. Personalized cancer vaccines that are tailored to an individual patient's tumor are showing very promising results.",
      },
      {
        speaker: 'HOST',
        text: "That's genuinely exciting. A technology born from a pandemic could end up transforming medicine.",
      },
      {
        speaker: 'EXPERT',
        text: 'It already is. And the speed of development will only increase as we build better tools for designing and manufacturing mRNA sequences.',
      },
    ],
  ];

  // Reference templates per podcast
  const referenceSets: {
    title: string;
    authors: string[];
    year: number;
    url: string;
    type: 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE';
  }[][] = [
    // Cryptography
    [
      {
        title: 'The Code Book: The Science of Secrecy from Ancient Egypt to Quantum Cryptography',
        authors: ['Simon Singh'],
        year: 1999,
        url: 'https://www.simonsingh.net/books/the-code-book/',
        type: 'BOOK',
      },
      {
        title: 'A History of Cryptography and Cryptanalysis',
        authors: ['John F. Dooley'],
        year: 2018,
        url: 'https://link.springer.com/book/10.1007/978-3-319-90443-6',
        type: 'BOOK',
      },
      {
        title: 'The Enigma Machine and Its Role in WWII',
        authors: ['Bletchley Park Trust'],
        year: 2023,
        url: 'https://bletchleypark.org.uk/our-story/enigma',
        type: 'WEB',
      },
      {
        title: 'A Method for Obtaining Digital Signatures and Public-Key Cryptosystems',
        authors: ['Ron Rivest', 'Adi Shamir', 'Leonard Adleman'],
        year: 1978,
        url: 'https://people.csail.mit.edu/rivest/Rsapaper.pdf',
        type: 'PAPER',
      },
    ],
    // Quantum Computing
    [
      {
        title: 'Quantum Computing: An Applied Approach',
        authors: ['Jack D. Hidary'],
        year: 2021,
        url: 'https://link.springer.com/book/10.1007/978-3-030-83274-2',
        type: 'BOOK',
      },
      {
        title: "Shor's Algorithm for Factoring Large Integers",
        authors: ['Peter W. Shor'],
        year: 1994,
        url: 'https://arxiv.org/abs/quant-ph/9508027',
        type: 'PAPER',
      },
      {
        title: 'Post-Quantum Cryptography Standardization',
        authors: ['NIST'],
        year: 2024,
        url: 'https://csrc.nist.gov/projects/post-quantum-cryptography',
        type: 'WEB',
      },
      {
        title: 'A fast quantum mechanical algorithm for database search',
        authors: ['Lov K. Grover'],
        year: 1996,
        url: 'https://arxiv.org/abs/quant-ph/9605043',
        type: 'PAPER',
      },
      {
        title: 'Quantum Supremacy Using a Programmable Superconducting Processor',
        authors: ['Frank Arute', 'Kunal Arya', 'et al.'],
        year: 2019,
        url: 'https://www.nature.com/articles/s41586-019-1666-5',
        type: 'PAPER',
      },
    ],
    // Remote Work
    [
      {
        title: 'Remote: Office Not Required',
        authors: ['Jason Fried', 'David Heinemeier Hansson'],
        year: 2013,
        url: 'https://basecamp.com/books/remote',
        type: 'BOOK',
      },
      {
        title: 'The Future of Remote Work',
        authors: ['McKinsey Global Institute'],
        year: 2023,
        url: 'https://www.mckinsey.com/featured-insights/future-of-work',
        type: 'ARTICLE',
      },
      {
        title: 'Does Working from Home Work? Evidence from a Chinese Experiment',
        authors: ['Nicholas Bloom', 'James Liang', 'John Roberts', 'Zhichun Jenny Ying'],
        year: 2015,
        url: 'https://academic.oup.com/qje/article/130/1/165/2337855',
        type: 'PAPER',
      },
    ],
    // AI Ethics
    [
      {
        title: 'On the Dangers of Stochastic Parrots',
        authors: [
          'Emily M. Bender',
          'Timnit Gebru',
          'Angelina McMillan-Major',
          'Shmargaret Shmitchell',
        ],
        year: 2021,
        url: 'https://dl.acm.org/doi/10.1145/3442188.3445922',
        type: 'PAPER',
      },
      {
        title: 'Weapons of Math Destruction',
        authors: ["Cathy O'Neil"],
        year: 2016,
        url: 'https://weaponsofmathdestructionbook.com/',
        type: 'BOOK',
      },
      {
        title: 'The Ethics of Artificial Intelligence',
        authors: ['Nick Bostrom', 'Eliezer Yudkowsky'],
        year: 2014,
        url: 'https://intelligence.org/files/EthicsofAI.pdf',
        type: 'PAPER',
      },
      {
        title: 'EU Artificial Intelligence Act',
        authors: ['European Parliament'],
        year: 2024,
        url: 'https://artificialintelligenceact.eu/',
        type: 'WEB',
      },
    ],
    // Stoicism
    [
      {
        title: 'Meditations',
        authors: ['Marcus Aurelius'],
        year: 180,
        url: 'https://www.gutenberg.org/ebooks/2680',
        type: 'BOOK',
      },
      {
        title: 'Letters from a Stoic',
        authors: ['Seneca'],
        year: 65,
        url: 'https://www.gutenberg.org/ebooks/27523',
        type: 'BOOK',
      },
      {
        title: 'The Discourses of Epictetus',
        authors: ['Epictetus', 'Arrian'],
        year: 108,
        url: 'https://www.gutenberg.org/ebooks/10661',
        type: 'BOOK',
      },
      {
        title: 'How to Be a Stoic: Using Ancient Philosophy to Live a Modern Life',
        authors: ['Massimo Pigliucci'],
        year: 2017,
        url: 'https://massimopigliucci.com/books/',
        type: 'BOOK',
      },
      {
        title: 'A Guide to the Good Life: The Ancient Art of Stoic Joy',
        authors: ['William B. Irvine'],
        year: 2008,
        url: 'https://global.oup.com/academic/product/a-guide-to-the-good-life-9780195374612',
        type: 'BOOK',
      },
    ],
    // mRNA Vaccines
    [
      {
        title: 'Nucleoside-modified mRNA induces potent adaptive immune responses',
        authors: ['Katalin Kariko', 'Drew Weissman'],
        year: 2005,
        url: 'https://doi.org/10.1016/j.immuni.2005.06.005',
        type: 'PAPER',
      },
      {
        title: 'Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine',
        authors: ['Fernando P. Polack', 'et al.'],
        year: 2020,
        url: 'https://www.nejm.org/doi/full/10.1056/NEJMoa2034577',
        type: 'PAPER',
      },
      {
        title: 'mRNA vaccines — a new era in vaccinology',
        authors: ['Norbert Pardi', 'Michael J. Hogan', 'Frederick W. Porter', 'Drew Weissman'],
        year: 2018,
        url: 'https://www.nature.com/articles/nrd.2017.243',
        type: 'PAPER',
      },
      {
        title: 'Understanding mRNA COVID-19 Vaccines',
        authors: ['CDC'],
        year: 2024,
        url: 'https://www.cdc.gov/vaccines/covid-19/mrna.html',
        type: 'WEB',
      },
    ],
  ];

  const podcasts = [];
  for (let i = 0; i < podcastDefs.length; i++) {
    const def = podcastDefs[i];
    const segments = segmentSets[i];
    const refs = referenceSets[i];

    // Upsert podcast by checking if one with same title + userId exists
    let podcast = await prisma.podcast.findFirst({
      where: { title: def.title, userId: def.userId },
    });

    if (podcast) {
      podcast = await prisma.podcast.update({
        where: { id: podcast.id },
        data: {
          topic: def.topic,
          status: 'READY',
          visibility: def.visibility,
          playCount: def.playCount,
          likeCount: def.likeCount,
          forkCount: def.forkCount,
          duration: segments.length * 25, // ~25 seconds per segment
        },
      });
    } else {
      podcast = await prisma.podcast.create({
        data: {
          userId: def.userId,
          title: def.title,
          topic: def.topic,
          status: 'READY',
          visibility: def.visibility,
          playCount: def.playCount,
          likeCount: def.likeCount,
          forkCount: def.forkCount,
          duration: segments.length * 25,
        },
      });
    }
    podcasts.push(podcast);

    // Delete existing segments + references (idempotent re-creation)
    await prisma.segment.deleteMany({ where: { podcastId: podcast.id } });
    await prisma.reference.deleteMany({ where: { podcastId: podcast.id } });

    // Create segments
    await prisma.segment.createMany({
      data: segments.map((seg, idx) => ({
        podcastId: podcast!.id,
        speaker: seg.speaker,
        text: seg.text,
        order: idx,
        startTime: idx * 25,
        duration: 25,
        version: 1,
      })),
    });

    // Create references
    await prisma.reference.createMany({
      data: refs.map((ref, idx) => ({
        podcastId: podcast!.id,
        number: idx + 1,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        url: ref.url,
        type: ref.type,
        verificationStatus: 'VERIFIED',
      })),
    });

    // Create tags
    for (const slug of def.tags) {
      const tagId = tagMap[slug];
      if (!tagId) continue;
      await prisma.podcastTag.create({ data: { podcastId: podcast.id, tagId } }).catch(() => {}); // ignore if already exists
    }
  }
  console.log(`  Created ${podcasts.length} podcasts with segments and references`);

  // ── 7. Interaction on the quantum computing podcast ─────────────
  const quantumPodcast = podcasts[1];
  if (quantumPodcast) {
    const existing = await prisma.interaction.findFirst({
      where: { podcastId: quantumPodcast.id, userId: demoUser.id },
    });
    if (!existing) {
      await prisma.interaction.create({
        data: {
          podcastId: quantumPodcast.id,
          userId: demoUser.id,
          status: 'RESOLVED',
          question:
            'Wait, if quantum computers can break RSA encryption, does that mean all our current internet security is at risk?',
          timestamp: 125.0,
          answer:
            "Great question! Yes, a sufficiently powerful quantum computer running Shor's algorithm could theoretically break RSA and other public-key cryptography systems. However, we're not there yet — current quantum computers have around 1,000 qubits, while breaking RSA-2048 would require millions of error-corrected qubits. In the meantime, NIST has already standardized post-quantum cryptographic algorithms like CRYSTALS-Kyber and CRYSTALS-Dilithium that are resistant to quantum attacks. The transition to quantum-safe encryption is already underway.",
          resolved: true,
          incorporated: false,
        },
      });
      console.log('  Created interaction on quantum computing podcast');
    }
  }

  // ── 8. Follows (make demo user popular) ─────────────────────────
  const followPairs = [
    ...createdUsers.slice(0, 7).map((u) => ({ followerId: u.id, followingId: demoUser.id })),
    { followerId: demoUser.id, followingId: createdUsers[0].id },
    { followerId: demoUser.id, followingId: createdUsers[1].id },
    { followerId: createdUsers[2].id, followingId: createdUsers[0].id },
    { followerId: createdUsers[3].id, followingId: createdUsers[1].id },
  ];

  for (const pair of followPairs) {
    await prisma.follow.create({ data: pair }).catch(() => {}); // ignore if already exists
  }
  console.log(`  Created ${followPairs.length} follow relationships`);

  // ── 9. Comments on Cryptography podcast ───────────────────────
  const cryptoPodcast = podcasts[0];
  if (cryptoPodcast) {
    const commentAuthors = [
      { user: createdUsers[0], content: 'The Enigma section was fascinating. I had no idea Turing\'s work saved that many lives.' },
      { user: createdUsers[1], content: 'Would love a deep dive on post-quantum cryptography!' },
      { user: createdUsers[2], content: 'Shared this with my CS class. Great explanation of RSA.' },
    ];
    for (const c of commentAuthors) {
      await prisma.comment.create({
        data: {
          podcastId: cryptoPodcast.id,
          userId: c.user.id,
          content: c.content,
        },
      }).catch(() => {}); // ignore if already exists
    }
    console.log('  Created 3 comments on Cryptography podcast');
  }

  // ── 10. Likes on top 3 podcasts ──────────────────────────────
  const likeUsers = createdUsers.slice(0, 5);
  const likePodcasts = podcasts.slice(0, 3);
  for (const podcast of likePodcasts) {
    for (const user of likeUsers) {
      await prisma.like.create({
        data: { podcastId: podcast.id, userId: user.id },
      }).catch(() => {}); // ignore @@unique constraint
    }
  }
  console.log(`  Created likes from ${likeUsers.length} users on ${likePodcasts.length} podcasts`);

  // ── 11. Set audioUrl on Cryptography podcast ──────────────────
  if (cryptoPodcast) {
    await prisma.podcast.update({
      where: { id: cryptoPodcast.id },
      data: { audioUrl: '/demo-audio.mp3' },
    });
    console.log('  Set audioUrl on Cryptography podcast');
  }

  // ── 12. SCRIPT_READY podcast — "The Psychology of Decision Making" ──
  const scriptReadyTurns = [
    { speaker: 'HOST', text: 'Welcome to Sotto. Today we\'re exploring something that affects every single decision you make — the psychology behind why we choose what we choose.' },
    { speaker: 'EXPERT', text: 'And spoiler alert — most of those choices aren\'t nearly as rational as we think they are. Our brains use mental shortcuts called heuristics that often lead us astray.' },
    { speaker: 'HOST', text: 'Let\'s start with one of the most famous: the anchoring effect.' },
    { speaker: 'EXPERT', text: 'Anchoring is when the first piece of information you encounter disproportionately influences your judgment. In experiments, even random numbers can anchor people\'s estimates of completely unrelated quantities.' },
    { speaker: 'HOST', text: 'That explains why retail stores show the "original price" crossed out next to the sale price.' },
    { speaker: 'EXPERT', text: 'Exactly. The anchor makes the sale price feel like a bargain, even if it\'s still overpriced. Daniel Kahneman and Amos Tversky demonstrated this beautifully in their Nobel Prize-winning research.' },
    { speaker: 'HOST', text: 'What about loss aversion? I\'ve heard we feel losses more intensely than gains.' },
    { speaker: 'EXPERT', text: 'Roughly twice as intensely, according to prospect theory. Losing $100 feels about as bad as gaining $200 feels good. This asymmetry drives everything from investment behavior to why people stay in bad relationships.' },
    { speaker: 'HOST', text: 'And then there\'s the paradox of choice — the idea that more options can actually make us less happy.' },
    { speaker: 'EXPERT', text: 'Barry Schwartz showed that when faced with too many options, people either freeze and choose nothing, or they choose but feel less satisfied — always wondering if another option would have been better. It\'s the tyranny of abundance.' },
  ];

  const scriptReadyMarkdown = scriptReadyTurns
    .map((t) => `**${t.speaker}:** ${t.text}`)
    .join('\n\n');

  let scriptReadyPodcast = await prisma.podcast.findFirst({
    where: { title: 'The Psychology of Decision Making', userId: demoUser.id },
  });

  if (scriptReadyPodcast) {
    scriptReadyPodcast = await prisma.podcast.update({
      where: { id: scriptReadyPodcast.id },
      data: {
        status: 'SCRIPT_READY',
        visibility: 'PUBLIC',
        topic: 'Why we make irrational choices — anchoring, loss aversion, the paradox of choice, and the cognitive biases that shape our decisions.',
      },
    });
  } else {
    scriptReadyPodcast = await prisma.podcast.create({
      data: {
        userId: demoUser.id,
        title: 'The Psychology of Decision Making',
        topic: 'Why we make irrational choices — anchoring, loss aversion, the paradox of choice, and the cognitive biases that shape our decisions.',
        status: 'SCRIPT_READY',
        visibility: 'PUBLIC',
        playCount: 0,
        likeCount: 0,
        forkCount: 0,
        duration: 0,
      },
    });
  }

  // Upsert Script record
  await prisma.script.upsert({
    where: { podcastId: scriptReadyPodcast.id },
    update: { turns: scriptReadyTurns, markdown: scriptReadyMarkdown },
    create: {
      podcastId: scriptReadyPodcast.id,
      turns: scriptReadyTurns,
      markdown: scriptReadyMarkdown,
    },
  });

  // Tag it
  if (tagMap['philosophy']) {
    await prisma.podcastTag.create({
      data: { podcastId: scriptReadyPodcast.id, tagId: tagMap['philosophy'] },
    }).catch(() => {});
  }
  if (tagMap['science']) {
    await prisma.podcastTag.create({
      data: { podcastId: scriptReadyPodcast.id, tagId: tagMap['science'] },
    }).catch(() => {});
  }

  console.log(`  Created SCRIPT_READY podcast: ${scriptReadyPodcast.id}`);

  // ── 13. Activity entries ──────────────────────────────────────
  const activityEntries = [
    {
      userId: demoUser.id,
      type: 'PODCAST_CREATED',
      targetId: cryptoPodcast?.id,
      targetType: 'podcast',
      metadata: { title: 'The Hidden History of Cryptography' },
    },
    {
      userId: demoUser.id,
      type: 'PODCAST_CREATED',
      targetId: podcasts[1]?.id,
      targetType: 'podcast',
      metadata: { title: 'Understanding Quantum Computing' },
    },
    {
      userId: createdUsers[0].id,
      type: 'USER_FOLLOWED',
      targetId: demoUser.id,
      targetType: 'user',
      metadata: { name: 'Nico Valerio' },
    },
    {
      userId: demoUser.id,
      type: 'PODCAST_CREATED',
      targetId: scriptReadyPodcast.id,
      targetType: 'podcast',
      metadata: { title: 'The Psychology of Decision Making' },
    },
  ];
  for (const entry of activityEntries) {
    await prisma.activity.create({ data: entry }).catch(() => {});
  }
  console.log(`  Created ${activityEntries.length} activity entries`);

  console.log('\nDemo data seeded successfully!');
  console.log(`  Demo user:  ${demoUser.email} (${demoUser.id})`);
  console.log(`  Admin user: ${adminUser.email} (${adminUser.id})`);
  console.log(`  Podcasts:   ${podcasts.length + 1} (including SCRIPT_READY)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
