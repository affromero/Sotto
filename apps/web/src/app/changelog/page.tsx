import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Changelog — Sotto',
  description: 'What\'s new in Sotto — the latest features, improvements, and fixes.',
};

type TagType = 'feature' | 'improvement' | 'fix';

interface ChangelogEntry {
  date: string;
  title: string;
  description: string;
  tags: TagType[];
}

const TAG_LABELS: Record<TagType, string> = {
  feature: 'Feature',
  improvement: 'Improvement',
  fix: 'Fix',
};

const entries: ChangelogEntry[] = [
  {
    date: '2026-02-19',
    title: 'GDPR Compliance & Data Export',
    description:
      'Full GDPR-compliant privacy policy, one-click data export to JSON, and automatic cleanup of orphaned audio files on account deletion.',
    tags: ['feature'],
  },
  {
    date: '2026-02-17',
    title: 'Markdown Transcripts & Auto-PDF',
    description:
      'Replaced binary PDF transcripts with beautifully formatted markdown. Transcripts are now auto-generated after audio stitching — no manual export needed.',
    tags: ['improvement'],
  },
  {
    date: '2026-02-16',
    title: 'Audio File Size Reduction',
    description:
      'Optimized audio encoding settings to significantly reduce file sizes without quality loss. Segment audio files are cleaned up from storage after stitching.',
    tags: ['improvement'],
  },
  {
    date: '2026-02-14',
    title: 'Admin Impersonation',
    description:
      'Admins can now impersonate any user to debug issues, with a visible banner and audit trail. Account switcher shows the real identity at all times.',
    tags: ['feature'],
  },
  {
    date: '2026-02-12',
    title: 'Cost Dashboard',
    description:
      'Comprehensive cost tracking across AI, TTS, STT, embeddings, and moderation. Model-level grouping shows exactly where spend is going.',
    tags: ['feature'],
  },
  {
    date: '2026-02-10',
    title: 'Creator Analytics',
    description:
      'Per-podcast analytics with listener retention curves, behavior breakdowns, and performance metrics. Plus platform-wide recommendation and intelligence dashboards.',
    tags: ['feature'],
  },
  {
    date: '2026-02-08',
    title: 'Security Hardening',
    description:
      'Rate limiting on auth endpoints, SSRF protection, SQL injection fixes, timing-safe comparisons, and Redis password requirement in production.',
    tags: ['fix'],
  },
  {
    date: '2026-02-06',
    title: 'Fal.ai & Replicate TTS Providers',
    description:
      'Added Fal.ai and Replicate as TTS providers using Qwen3-TTS. BYOK users can now choose from 7 different TTS providers with per-model selection.',
    tags: ['feature'],
  },
  {
    date: '2026-02-04',
    title: 'TTS Model Selection',
    description:
      'BYOK users can now pick specific TTS models within their chosen provider — from ElevenLabs Turbo v2.5 to OpenAI Shimmer.',
    tags: ['feature'],
  },
  {
    date: '2026-02-01',
    title: 'Apple Sign In',
    description:
      'Sign in with Apple is now available on both web and iOS. Secret rotation monitoring keeps the integration healthy.',
    tags: ['feature'],
  },
  {
    date: '2026-01-28',
    title: 'Telegram Bot',
    description:
      'Generate podcasts by messaging your configured Telegram bot. Send a topic or a URL and get a podcast link back — the full pipeline runs automatically.',
    tags: ['feature'],
  },
  {
    date: '2026-01-25',
    title: 'Paid Voice Sharing',
    description:
      'Operators can enable paid access requests for verified voice clones via Stripe Connect. The feature stays disabled by default for private-first and self-hosted installs.',
    tags: ['feature'],
  },
  {
    date: '2026-01-18',
    title: 'Twitter Bot',
    description:
      'Tag your configured Twitter bot to generate a podcast from any tweet or thread. Automatic replies with the podcast link once generation completes.',
    tags: ['feature'],
  },
  {
    date: '2026-01-15',
    title: 'Topic-Aware Voice Selection',
    description:
      'Voices are now matched to the podcast topic — technical subjects get different voice pairings than casual conversations.',
    tags: ['improvement'],
  },
  {
    date: '2026-01-12',
    title: 'Content Moderation',
    description:
      'Automated safety checks on user-generated content using OpenAI moderation API. Reports, warnings, suspensions, and bans for policy violations.',
    tags: ['feature'],
  },
  {
    date: '2026-01-08',
    title: 'Taste Quiz & Recommendations',
    description:
      'Quick yes/no taste quiz during onboarding builds a behavioral profile. The feed now shows personalized "Picks for You" based on your interests.',
    tags: ['feature'],
  },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ChangelogPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Changelog</h1>
          <p className={styles.subtitle}>
            New features, improvements, and fixes shipped to Sotto.
          </p>
        </header>

        <div className={styles.timeline}>
          {entries.map((entry) => (
            <article key={entry.date + entry.title} className={styles.entry}>
              <time className={styles.date} dateTime={entry.date}>
                {formatDate(entry.date)}
              </time>
              <div className={styles.entryContent}>
                <div className={styles.entryHeader}>
                  <h2 className={styles.entryTitle}>{entry.title}</h2>
                  <div className={styles.tags}>
                    {entry.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`${styles.tag} ${styles[`tag_${tag}`]}`}
                      >
                        {TAG_LABELS[tag]}
                      </span>
                    ))}
                  </div>
                </div>
                <p className={styles.entryDescription}>{entry.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
      <Footer />
    </>
  );
}
