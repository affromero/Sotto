import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { profileUrl } from '@/lib/urls';

export const dynamic = 'force-dynamic';

export default async function ProfileRedirectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, handle: true },
  });

  redirect(profileUrl(user ?? { id: session.user.id }));
}
