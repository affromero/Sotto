import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { AnnouncementsForm } from './AnnouncementsForm';
import styles from './page.module.css';

export default async function AdminAnnouncementsPage() {
  const userCount = await prisma.user.count();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Announcements</h1>
        <p className={styles.subtitle}>
          Send a platform message to all {userCount.toLocaleString()} registered users via in-app
          notification, push, and email.
        </p>
      </div>

      <AnnouncementsForm userCount={userCount} />
    </div>
  );
}
