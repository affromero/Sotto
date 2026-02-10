'use client';

import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export function CreateAsSottoButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className={styles.searchButton}
      onClick={() => router.push('/create?as=sotto')}
    >
      Create as @sotto
    </button>
  );
}
