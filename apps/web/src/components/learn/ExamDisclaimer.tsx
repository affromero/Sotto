import styles from './ExamDisclaimer.module.css';

interface Props {
  examName: string;
  institutionLabel: string;
}

/**
 * The unaffiliated-practice notice for a mock exam. We model the format of the
 * real exam, but are not affiliated with the institution and the result is not an
 * official score. Shown on the exam hub, runner, and results.
 */
export function ExamDisclaimer({ examName, institutionLabel }: Props) {
  return (
    <p className={styles.root} role="note">
      <span className={styles.mark} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.5h.01" />
        </svg>
      </span>
      <span>
        This is a practice exam modeled on the format of the {examName}. It is not affiliated with
        or endorsed by {institutionLabel}, and the result is not an official score.
      </span>
    </p>
  );
}
