'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AccessSecurity } from 'thesidedoor/react';
import theme from '../AccessScreen.module.css';
import styles from './SecurityScreen.module.css';

export function SecurityScreen() {
  const router = useRouter();
  return (
    <main className={theme.root}>
      <p className={theme.brand}>Sotto</p>
      <div className={styles.content}>
        <Link className={styles.back} href="/dashboard">
          Back to learning
        </Link>
        <AccessSecurity
          endpoint="/api/v1/access"
          showRecoveryCodes={false}
          classes={{
            root: styles.security,
            form: theme.form,
            label: theme.label,
            input: theme.input,
            button: theme.button,
            secondary: theme.secondary,
            error: theme.error,
            hint: theme.hint,
          }}
          onSignInRequired={() => {
            router.push('/access?returnTo=security');
            router.refresh();
          }}
          onHouseholdEntered={() => {
            router.push('/profiles');
            router.refresh();
          }}
        />
      </div>
    </main>
  );
}
