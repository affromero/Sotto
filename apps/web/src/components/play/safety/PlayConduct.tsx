'use client';

import type { PlaySafetyPolicy } from '@sotto/shared';
import styles from './PlayConduct.module.css';

export function PlayConduct({
  policy,
  accepted,
  onChange,
  disabled = false,
  requireAcceptance = true,
}: {
  policy: PlaySafetyPolicy | null;
  accepted: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  requireAcceptance?: boolean;
}) {
  if (!policy) return <p role="status">Loading this server&apos;s game conduct…</p>;
  return (
    <section className={styles.root} aria-label="Game conduct">
      <h2>{policy.title}</h2>
      {policy.paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <div className={styles.links}>
        <a href={policy.termsPath} target="_blank" rel="noopener noreferrer">
          Server terms
        </a>
        <a href={policy.privacyPath} target="_blank" rel="noopener noreferrer">
          Server privacy
        </a>
        {policy.operatorContactUrl && (
          <a href={policy.operatorContactUrl}>Contact this server&apos;s operator</a>
        )}
      </div>
      {!policy.operatorContactUrl && (
        <p>This server has not published an operator contact. Reports go to its owner.</p>
      )}
      {requireAcceptance && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={accepted}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
          I accept this server&apos;s game conduct
        </label>
      )}
    </section>
  );
}
