import { LandingShell } from '@/components/landing/LandingShell';
import { LandingNav } from '@/components/landing/LandingNav';
import { WaitlistProvider } from '@/components/landing/WaitlistProvider';
import { JsonLd } from '@/components/landing/JsonLd';
import { HeroChapter } from '@/components/landing/chapters/HeroChapter';
import { JourneyChapter } from '@/components/landing/chapters/JourneyChapter';
import { TrustChapter } from '@/components/landing/chapters/TrustChapter';
import { NetworkChapter } from '@/components/landing/chapters/NetworkChapter';
import { ConvertChapter } from '@/components/landing/chapters/ConvertChapter';
import styles from './page.module.css';

export default function LandingPage() {
  return (
    <WaitlistProvider>
      <LandingShell>
        <JsonLd />
        <LandingNav />

        <div className={styles.chapters}>
          <HeroChapter />
          <JourneyChapter />
          <TrustChapter />
          <NetworkChapter />
          <ConvertChapter />
        </div>
      </LandingShell>
    </WaitlistProvider>
  );
}
