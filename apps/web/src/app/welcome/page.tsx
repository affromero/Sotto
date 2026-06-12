import { WelcomeFlow } from './WelcomeFlow';
import { isSelfHosted } from '@/lib/self-hosted';

export const metadata = {
  title: 'Welcome to Sotto',
  robots: { index: false, follow: false },
};

export default function WelcomePage() {
  return <WelcomeFlow initialConfig={{ selfHosted: isSelfHosted(), isOwner: false }} />;
}
