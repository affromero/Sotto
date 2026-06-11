import styles from './CefrDisclaimer.module.css';

interface Props {
  /** 'full' explains the path to a real credential; 'compact' is a one-liner. */
  variant?: 'full' | 'compact';
}

/**
 * Honest scope note: Sotto's CEFR levels track progress inside Sotto and are not an
 * official certificate. Shown wherever a level is assigned or advanced (placement,
 * the learn hub, class wrap-up) and on the mock exams.
 */
export function CefrDisclaimer({ variant = 'full' }: Props) {
  return (
    <p className={`${styles.root} ${variant === 'compact' ? styles.compact : ''}`} role="note">
      <span className={styles.mark} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5h.01" />
        </svg>
      </span>
      {variant === 'compact' ? (
        <span>Sotto levels track your progress here, not an official CEFR certificate.</span>
      ) : (
        <span>
          Sotto&rsquo;s levels (A1 to C2) track your progress inside Sotto. They are not an official
          CEFR certificate. For a recognized credential, take an exam at an accredited institution
          such as the Goethe-Institut, Instituto Cervantes, or Cambridge Assessment.
        </span>
      )}
    </p>
  );
}
