import { WelcomeFlow } from './WelcomeFlow';

export const metadata = {
  title: 'Welcome to Sotto',
  robots: { index: false, follow: false },
};

export default function WelcomePage() {
  return <WelcomeFlow />;
}
