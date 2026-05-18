import { BRAND } from '@sotto/shared';
import styles from './SottoBadge.module.css';

export function SottoBadge() {
  return (
    <a
      href={`${BRAND.url}?utm_source=badge&utm_medium=badge&utm_campaign=made_with`}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.badge}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      Made with Sotto
    </a>
  );
}
