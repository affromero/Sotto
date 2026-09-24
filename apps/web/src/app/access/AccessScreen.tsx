'use client';

import { AccessForm } from 'thesidedoor/react';
import styles from './AccessScreen.module.css';

export function AccessScreen({ returnToSecurity }: { returnToSecurity: boolean }) {
  return (
    <main className={styles.root}>
      <p className={styles.brand}>Sotto</p>
      <div className={styles.content}>
        <h1 className={styles.heading}>Open Sotto</h1>
        <p className={styles.sub}>Enter the shared password, then choose a profile.</p>
        <AccessForm
          endpoint="/api/v1/access"
          initialMode="household"
          modes={['household']}
          claimModes={['household']}
          classes={{
            root: styles.access,
            form: styles.form,
            navigation: styles.navigation,
            label: styles.label,
            input: styles.input,
            button: styles.button,
            secondary: styles.secondary,
            error: styles.error,
            hint: styles.hint,
          }}
          onSignedIn={(session) =>
            window.location.assign(
              session.principal
                ? returnToSecurity
                  ? '/access/security'
                  : '/dashboard'
                : '/profiles'
            )
          }
        />
      </div>
    </main>
  );
}
