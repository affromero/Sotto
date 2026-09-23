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
        <p className={styles.sub}>Enter your household, then choose a profile.</p>
        <AccessForm
          endpoint="/api/v1/access"
          initialMode={mode}
          modes={['household', 'claim', 'recover']}
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
