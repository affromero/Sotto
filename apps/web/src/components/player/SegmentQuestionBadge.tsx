import styles from './SegmentQuestionBadge.module.css';

interface SegmentQuestionBadgeProps {
  count: number;
}

export function SegmentQuestionBadge({ count }: SegmentQuestionBadgeProps) {
  if (count <= 0) return null;

  return (
    <span className={styles.badge} aria-label={`${count} question${count !== 1 ? 's' : ''}`}>
      <svg className={styles.icon} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 11a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm1-3.5a.5.5 0 0 1-1 0v-.5c0-.866.784-1.5 1.5-1.5A1.5 1.5 0 0 0 11 5 1.5 1.5 0 0 0 8 4a.5.5 0 0 1-1 0A2.5 2.5 0 1 1 10.5 7c0 .397-.316.75-.75.75a.5.5 0 0 0-.75.25v.5z" />
      </svg>
      {count}
    </span>
  );
}
