import { LandingShowcaseDashboard } from './LandingShowcaseDashboard';
import styles from './page.module.css';

export default function AdminLandingPage() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Landing Showcase</h1>
        <p className={styles.subtitle}>
          Configure the showcase podcast that powers all interactive landing page chapters
        </p>
      </div>

      <LandingShowcaseDashboard />
    </div>
  );
}
