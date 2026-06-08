import type { Metadata } from 'next';
import { PlacementTest } from '@/components/placement/PlacementTest';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Placement Test',
  description: 'Find your starting level with a quick adaptive placement test.',
  robots: { index: false, follow: false },
};

const VALID_PAIRS = ['DE_FROM_EN', 'EN_FROM_ES', 'ES_FROM_EN'] as const;
type Pair = (typeof VALID_PAIRS)[number];

const PAIR_LABELS: Record<Pair, string> = {
  DE_FROM_EN: 'German',
  EN_FROM_ES: 'English',
  ES_FROM_EN: 'Spanish',
};

interface PlacementPageProps {
  searchParams: Promise<{ pair?: string }>;
}

export default async function PlacementPage({ searchParams }: PlacementPageProps) {
  const params = await searchParams;
  const raw = params.pair ?? 'DE_FROM_EN';
  const pair: Pair = (VALID_PAIRS as readonly string[]).includes(raw)
    ? (raw as Pair)
    : 'DE_FROM_EN';
  const language = PAIR_LABELS[pair];

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Placement Test</h1>
        <p className={styles.subtitle}>
          Answer a short set of questions so we can place you at the right {language} level.
        </p>
      </header>

      <div className={styles.content}>
        <PlacementTest pair={pair} />
      </div>
    </main>
  );
}
