import type { Metadata } from 'next';
import { PlacementEntry } from '@/components/placement/PlacementEntry';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Placement Test',
  description: 'Find your starting level with a quick adaptive placement test.',
  robots: { index: false, follow: false },
};

const LANG_NAMES: Record<string, string> = {
  de: 'German', en: 'English', es: 'Spanish', fr: 'French', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic',
};
const langName = (code: string): string => LANG_NAMES[code] ?? code.toUpperCase();
const cleanCode = (value: string | undefined, fallback: string): string => {
  const c = (value ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : fallback;
};

interface PlacementPageProps {
  searchParams: Promise<{ native?: string; target?: string }>;
}

export default async function PlacementPage({ searchParams }: PlacementPageProps) {
  const params = await searchParams;
  const native = cleanCode(params.native, 'en');
  const target = cleanCode(params.target, 'de');

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Placement Test</h1>
        <p className={styles.subtitle}>
          Answer a short set of questions so we can place you at the right {langName(target)} level.
        </p>
      </header>

      <div className={styles.content}>
        <PlacementEntry native={native} target={target} />
      </div>
    </main>
  );
}
