import styles from './SottoLogo.module.css';

export function SottoLogo() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '/';

  return (
    <a href={appUrl} className={styles.root} aria-label="Sotto">
      <span className={styles.text}>sotto</span>
      <span className={styles.maps}>maps</span>
    </a>
  );
}
