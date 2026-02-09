'use client';

import { signIn } from 'next-auth/react';
import styles from './login/page.module.css';

interface AuthButtonsProps {
  callbackUrl?: string;
}

export function AuthButtons({ callbackUrl = '/dashboard' }: AuthButtonsProps) {
  return (
    <div className={styles.providers}>
      <button
        className={styles.providerBtn}
        onClick={() => signIn('google', { callbackUrl })}
        type="button"
      >
        Continue with Google
      </button>
      <button
        className={styles.providerBtn}
        onClick={() => signIn('github', { callbackUrl })}
        type="button"
      >
        Continue with GitHub
      </button>
    </div>
  );
}
