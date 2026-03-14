import { LandingShell } from '@/components/landing/LandingShell';
import { LandingNav } from '@/components/landing/LandingNav';
import { WaitlistProvider } from '@/components/landing/WaitlistProvider';
import { JsonLd } from '@/components/landing/JsonLd';
import { HeroChapter } from '@/components/landing/chapters/HeroChapter';
import { JourneyChapter } from '@/components/landing/chapters/JourneyChapter';
import { TrustChapter } from '@/components/landing/chapters/TrustChapter';
import { NetworkChapter } from '@/components/landing/chapters/NetworkChapter';
import { ShowcaseChapter } from '@/components/landing/chapters/ShowcaseChapter';
import { BotChapter } from '@/components/landing/chapters/BotChapter';
import { ConvertChapter } from '@/components/landing/chapters/ConvertChapter';
import { getShowcasePodcast, getLandingShowcaseData } from '@/lib/showcase';
import styles from './page.module.css';

export default async function LandingPage() {
  const showcaseData = await getLandingShowcaseData();
  const showcase = showcaseData?.podcast ?? await getShowcasePodcast();

  return (
    <WaitlistProvider>
      <LandingShell>
        <JsonLd />
        <LandingNav />

        <div className={styles.chapters}>
          <HeroChapter showcase={showcase} />
          <JourneyChapter showcase={showcaseData} />
          <ShowcaseChapter showcase={showcaseData} />
          <TrustChapter />
          <NetworkChapter />
          <BotChapter showcase={showcaseData} />
          <ConvertChapter />
        </div>
      </LandingShell>
    </WaitlistProvider>
  );
}
