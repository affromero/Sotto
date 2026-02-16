import { TwitterDashboard } from './TwitterDashboard';
import styles from './page.module.css';

export default function AdminTwitterPage() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Twitter Dashboard</h1>
        <p className={styles.subtitle}>
          Manage @sottofm auto-tweets, trending topics, thread imports, and analytics
        </p>
      </div>

      <TwitterDashboard />
    </div>
  );
}
