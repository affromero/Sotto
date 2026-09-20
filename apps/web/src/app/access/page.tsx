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
  searchParams: Promise<{ mode?: string; returnTo?: string }>;
}) {
  const { mode, returnTo } = await searchParams;
  const selectedMode =
    mode === 'claim' || mode === 'recover' || mode === 'household' ? mode : 'login';
  return <AccessScreen mode={selectedMode} returnToSecurity={returnTo === 'security'} />;
}
