import { getRedisClient } from '@/lib/redis';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { QueueActions } from './QueueActions';
import styles from './page.module.css';

export const metadata = { title: 'Queues — Sotto Admin' };

export const dynamic = 'force-dynamic';

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export default async function QueuesPage() {
  const redis = getRedisClient();
  const queues: Record<string, QueueStats> = {};

  await Promise.all(
    ALL_QUEUE_NAMES.map(async (name) => {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        redis.llen(`bull:${name}:wait`),
        redis.llen(`bull:${name}:active`),
        redis.zcard(`bull:${name}:completed`),
        redis.zcard(`bull:${name}:failed`),
        redis.zcard(`bull:${name}:delayed`),
      ]);
      queues[name] = { waiting, active, completed, failed, delayed };
    })
  );

  const totalActive = Object.values(queues).reduce((sum, q) => sum + q.active, 0);
  const totalWaiting = Object.values(queues).reduce((sum, q) => sum + q.waiting, 0);
  const totalFailed = Object.values(queues).reduce((sum, q) => sum + q.failed, 0);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Queues</h1>

      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{totalActive}</span>
          <span className={styles.summaryLabel}>Active</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryValue}>{totalWaiting}</span>
          <span className={styles.summaryLabel}>Waiting</span>
        </div>
        <div className={`${styles.summaryCard} ${totalFailed > 0 ? styles.summaryCardFailed : ''}`}>
          <span className={styles.summaryValue}>{totalFailed}</span>
          <span className={styles.summaryLabel}>Failed</span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Queue</th>
              <th>Waiting</th>
              <th>Active</th>
              <th>Completed</th>
              <th>Failed</th>
              <th>Delayed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ALL_QUEUE_NAMES.map((name) => {
              const stats = queues[name];
              const rowClass = stats.failed > 0 ? styles.rowFailed : stats.waiting > 0 ? styles.rowWaiting : undefined;
              return (
                <tr key={name} className={rowClass}>
                  <td className={styles.queueName}>{name}</td>
                  <td>{stats.waiting}</td>
                  <td>{stats.active}</td>
                  <td>{stats.completed}</td>
                  <td>{stats.failed}</td>
                  <td>{stats.delayed}</td>
                  <td>
                    {stats.failed > 0 && <QueueActions queueName={name} failedCount={stats.failed} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
