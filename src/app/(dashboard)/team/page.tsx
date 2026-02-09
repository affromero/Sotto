import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TeamManagement } from './TeamManagement';
import { CreateTeamClient } from './CreateTeamClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    redirect('/auth/login');
  }

  // Check subscription
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { tier: true },
  });

  const tier = subscription?.tier || 'FREE';

  if (tier !== 'TEAM') {
    return (
      <main className={styles.main}>
        <div className={styles.upgradeCard}>
          <h1 className={styles.upgradeTitle}>Team</h1>
          <p className={styles.upgradeText}>
            Upgrade to a Team plan to create a team, invite members, and collaborate on podcasts.
          </p>
          <Link href="/billing" className={styles.upgradeLink}>
            Upgrade to Team
          </Link>
        </div>
      </main>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { teamId: true },
  });

  if (!user?.teamId) {
    // Show "create team" state — handled by TeamManagement detecting no team
    return (
      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Team</h1>
        <div className={styles.upgradeCard}>
          <h2 className={styles.upgradeTitle}>Create Your Team</h2>
          <p className={styles.upgradeText}>
            You have a Team subscription but have not created a team yet.
          </p>
          <CreateTeamButton />
        </div>
      </main>
    );
  }

  const team = await prisma.team.findUnique({
    where: { id: user.teamId },
    include: {
      owner: { select: { id: true, name: true, email: true, image: true } },
      members: { select: { id: true, name: true, email: true, image: true } },
      invites: {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { members: true } },
    },
  });

  if (!team) {
    return null;
  }

  const teamData = {
    id: team.id,
    name: team.name,
    ownerId: team.ownerId,
    seats: team.seats,
    owner: team.owner,
    members: team.members,
    invites: team.invites.map((inv) => ({
      id: inv.id,
      email: inv.email,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
    })),
    _count: team._count,
  };

  return (
    <main>
      <TeamManagement team={teamData} userId={userId} />
    </main>
  );
}

function CreateTeamButton() {
  return <CreateTeamClient />;
}
