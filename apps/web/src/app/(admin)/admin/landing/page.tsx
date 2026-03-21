import { LandingShowcaseDashboard } from './LandingShowcaseDashboard';
import { VisualShowcasePanel } from './VisualShowcasePanel';
import styles from './page.module.css';

export default function AdminLandingPage() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Landing Showcase</h1>
        <p className={styles.subtitle}>
          Configure the showcase podcast and generate visual type examples for the landing page
        </p>
      </div>

      <VisualShowcasePanel />
      <LandingShowcaseDashboard />
    </div>
  );
}
