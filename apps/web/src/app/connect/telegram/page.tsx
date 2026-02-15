import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getRedisClient } from '@/lib/redis';
import { ConnectForm } from './ConnectForm';
import styles from './page.module.css';

export const metadata = { title: 'Connect Telegram' };

interface Props {
  searchParams: Promise<{ code?: string }>;
}

export default async function ConnectTelegramPage({ searchParams }: Props) {
  const { code } = await searchParams;

  if (!code) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.title}>Invalid Link</h1>
          <p className={styles.subtitle}>
            This link is missing a connection code. Please use the link sent by @SottoFMBot in Telegram.
          </p>
        </div>
      </main>
    );
  }

  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/login?callbackUrl=/connect/telegram?code=${encodeURIComponent(code)}`);
  }

  const redis = getRedisClient();
  const raw = await redis.get(`telegram:link:${code}`);

  if (!raw) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.title}>Link Expired</h1>
          <p className={styles.subtitle}>
            This connection link has expired. Please send /start to @SottoFMBot again to get a new link.
          </p>
        </div>
      </main>
    );
  }

  const linkData = JSON.parse(raw) as { telegramUserId: string; chatId: string; firstName: string };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Connect Telegram</h1>
        <p className={styles.subtitle}>
          Link your Telegram account to generate podcasts via @SottoFMBot.
        </p>
        <div className={styles.card}>
          <div className={styles.telegramInfo}>
            <span className={styles.label}>Telegram Account</span>
            <span className={styles.value}>{linkData.firstName}</span>
          </div>
          <div className={styles.telegramInfo}>
            <span className={styles.label}>Sotto Account</span>
            <span className={styles.value}>{session.user.name || session.user.email}</span>
          </div>
        </div>
        <ConnectForm code={code} />
      </div>
    </main>
  );
}
