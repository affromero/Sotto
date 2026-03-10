import { DemoStudio } from './DemoStudio';
import styles from './page.module.css';

export const metadata = { title: 'Launch Video Studio — Sotto Admin' };

export default function ShowcasePage() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Launch Video Studio</h1>
        <p className={styles.subtitle}>
          Orchestrate cinematic product launch videos.
        </p>
      </div>
      <DemoStudio />
    </div>
  );
}
