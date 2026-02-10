import { prisma } from '@/lib/prisma';
import { HandleManager } from './HandleManager';
import styles from './page.module.css';

export default async function AdminHandlesPage() {
  const handles = await prisma.reservedHandle.findMany({
    orderBy: { handle: 'asc' },
  });

  const serialized = handles.map((h) => ({
    id: h.id,
    handle: h.handle,
    reason: h.reason,
    createdAt: h.createdAt.toISOString(),
  }));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Reserved Handles</h1>
          <p className={styles.subtitle}>{handles.length} reserved handles</p>
        </div>
      </div>

      <HandleManager initialHandles={serialized} />
    </div>
  );
}
