import type { Metadata } from 'next';
import { AccessScreen } from './AccessScreen';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Access · Sotto',
  robots: { index: false, follow: false },
};

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return <AccessScreen returnToSecurity={returnTo === 'security'} />;
}
