import { Spinner } from '@/components/ui/Spinner';
import styles from './loading.module.css';

export default function AdminLoading() {
  return (
    <div className={styles.root}>
      <Spinner size="large" />
    </div>
  );
}
