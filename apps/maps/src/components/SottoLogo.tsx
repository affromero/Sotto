import styles from './SottoLogo.module.css';

export function SottoLogo() {
  return (
    <a href="https://sotto.fm" className={styles.root} aria-label="Sotto FM">
      <span className={styles.text}>sotto</span>
      <span className={styles.maps}>maps</span>
    </a>
  );
}
