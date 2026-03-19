import { LandingShell } from '@/components/landing/LandingShell';
import { LandingNav } from '@/components/landing/LandingNav';
import { WaitlistProvider } from '@/components/landing/WaitlistProvider';
import { ShowcaseTogglesProvider } from '@/components/landing/ShowcaseTogglesProvider';
import { JsonLd } from '@/components/landing/JsonLd';
import { HeroChapter } from '@/components/landing/chapters/HeroChapter';
import { JourneyChapter } from '@/components/landing/chapters/JourneyChapter';
import { TrustChapter } from '@/components/landing/chapters/TrustChapter';
import { NetworkChapter } from '@/components/landing/chapters/NetworkChapter';
import { ShowcaseChapter } from '@/components/landing/chapters/ShowcaseChapter';
import { IdentityChapter } from '@/components/landing/chapters/IdentityChapter';
import { BotChapter } from '@/components/landing/chapters/BotChapter';
import { FaqChapter } from '@/components/landing/chapters/FaqChapter';
import { ConvertChapter } from '@/components/landing/chapters/ConvertChapter';
import { getLandingShowcaseData } from '@/lib/showcase';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const showcaseData = await getLandingShowcaseData();

  return (
    <WaitlistProvider>
      <ShowcaseTogglesProvider>
        <LandingShell>
          <JsonLd />
          <LandingNav />

          <div className={styles.chapters}>
            <HeroChapter />
            <JourneyChapter showcase={showcaseData} />
            <ShowcaseChapter showcase={showcaseData} />
            <IdentityChapter />
            <TrustChapter />
            <NetworkChapter />
            <BotChapter showcase={showcaseData} />
            <FaqChapter />
            <ConvertChapter />
          </div>
        </LandingShell>
      </ShowcaseTogglesProvider>
    </WaitlistProvider>
  );
}
