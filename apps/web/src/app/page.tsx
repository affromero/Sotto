import { LandingShell } from '@/components/landing/LandingShell';
import { LandingNav } from '@/components/landing/LandingNav';
import { WaitlistProvider } from '@/components/landing/WaitlistProvider';
import { ShowcaseTogglesProvider } from '@/components/landing/ShowcaseTogglesProvider';
import { JsonLd } from '@/components/landing/JsonLd';
import { HeroChapter } from '@/components/landing/chapters/HeroChapter';
import { JourneyChapter } from '@/components/landing/chapters/JourneyChapter';
import { ShowcaseChapter } from '@/components/landing/chapters/ShowcaseChapter';
import { TrustChapter } from '@/components/landing/chapters/TrustChapter';
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
            <HeroChapter showcase={showcaseData} />
            <JourneyChapter showcase={showcaseData} />
            <ShowcaseChapter />
            <TrustChapter />
            <ConvertChapter />
          </div>
        </LandingShell>
      </ShowcaseTogglesProvider>
    </WaitlistProvider>
  );
}
