import { Check, X } from 'lucide-react';
import styles from './FeatureList.module.css';

interface Feature {
  text: string;
  included: boolean;
}

interface FeatureListProps {
  features: Feature[];
}

export function FeatureList({ features }: FeatureListProps) {
  return (
    <ul className={styles.list} role="list">
      {features.map((feature) => (
        <li
          key={feature.text}
          className={`${styles.item} ${feature.included ? styles.included : styles.excluded}`}
        >
          <span className={styles.icon} aria-hidden="true">
            {feature.included ? (
              <Check size={16} />
            ) : (
              <X size={16} />
            )}
          </span>
          <span className={styles.text}>
            {feature.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
