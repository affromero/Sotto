import Link from 'next/link';
import styles from './JoinCTA.module.css';

interface JoinCTAProps {
  creatorHandle: string | null;
  creatorName: string | null;
}

export function JoinCTA({ creatorHandle, creatorName }: JoinCTAProps) {
  const signupUrl = creatorHandle ? `/ref/${creatorHandle}` : '/auth/signup';
  const name = creatorName || 'creators';

  return (
    <div className={styles.bar}>
      <p className={styles.text}>
        Join {name} on Sotto — learn a language with your own AI tutor.
      </p>
      <Link href={signupUrl} className={styles.cta}>
        Join Sotto
      </Link>
    </div>
  );
}
