import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ApiKeyManager } from './ApiKeyManager';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API Keys' };

export default async function ApiKeysPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  const serializedKeys = keys.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
    revokedAt: k.revokedAt?.toISOString() ?? null,
  }));

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>API Keys</h1>
      <ApiKeyManager initialKeys={serializedKeys} />
    </main>
  );
}
