'use client';

import { AccessForm, type AccessFormMode } from 'thesidedoor/react';
import styles from './AccessScreen.module.css';

export function AccessScreen({
  mode,
  returnToSecurity,
}: {
  mode: AccessFormMode;
  returnToSecurity: boolean;
}) {
  return (
    <main className={styles.root}>
      <p className={styles.brand}>Sotto</p>
      <div className={styles.content}>
        <h1 className={styles.heading}>Your learning space</h1>
        <p className={styles.sub}>Sign in or enter your household</p>
        <AccessForm
          endpoint="/api/v1/access"
          initialMode={mode}
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
