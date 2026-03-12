import { getPlanFeatureConfig } from '@/lib/plan-feature-config';
import { PlanFeaturesForm } from './PlanFeaturesForm';
import styles from './page.module.css';

export default async function PlanFeaturesPage() {
  const config = await getPlanFeatureConfig();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Voice Features</h1>
        <p className={styles.subtitle}>
          Enable or disable voice management features per plan tier.
          Changes take effect immediately for all users.
        </p>
      </div>
      <PlanFeaturesForm initialConfig={config} />
    </div>
  );
}
