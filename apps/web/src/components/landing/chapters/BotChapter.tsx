import type { LandingShowcaseData } from '@/lib/showcase';
import { ScrollChapter } from '../ScrollChapter';
import styles from './BotChapter.module.css';

interface BotChapterProps {
  showcase: LandingShowcaseData | null;
}

const CHECK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function BotChapter({ showcase }: BotChapterProps) {
  const bot = showcase?.bot;
  const twHandle = bot?.twitterHandle ?? 'andres';
  const twName = bot?.twitterName ?? 'Andres';
  const twInitial = twName.charAt(0).toUpperCase();
  const podcastTitle = bot?.podcastTitle ?? 'The Psychology of Decision-Making';
  const podcastDuration = bot?.podcastDuration ?? '10 min';
  const podcastUrl = bot?.podcastUrl;
  const tgTopic = bot?.telegramTopic ?? 'quantum computing';

  return (
    <ScrollChapter dark>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>Generate from anywhere</span>
          <h2 className={styles.heading}>Tweet it. Message it. Done.</h2>
          <p className={styles.description}>
            Tag <strong><a href="https://x.com/sottofm" className={styles.extLink}>@sottofm</a></strong> on X to generate a podcast instantly, or message{' '}
            <strong><a href="https://t.me/SottoFMBot" className={styles.extLink}>@SottoFMBot</a></strong> on
            Telegram to save ideas for later. Come back and turn them into
            podcasts whenever you&apos;re ready.
          </p>
        </div>

        <div className={styles.grid}>
          {/* Twitter / X column */}
          <div className={styles.column} data-reveal>
            <span className={styles.label}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              X (Twitter)
            </span>

            <div className={styles.twMock}>
              {/* User tweet */}
              <div className={styles.twPost}>
                <div className={styles.twLeft}>
                  <div className={styles.twAvatar}>{twInitial}</div>
                  <div className={styles.twThread} />
                </div>
                <div className={styles.twBody}>
                  <div className={styles.twHeader}>
                    <span className={styles.twName}>{twName}</span>
                    <span>@{twHandle} &middot; 2m</span>
                  </div>
                  <div className={styles.twText}>
                    <a href="https://x.com/sottofm" className={styles.twMention}>@sottofm</a> make a podcast about{' '}
                    {podcastTitle.toLowerCase()}
                  </div>
                </div>
              </div>

              {/* @sottofm reply */}
              <div className={`${styles.twPost} ${styles.twPostReply}`}>
                <div className={styles.twLeft}>
                  <div className={styles.twAvatarSotto}>S</div>
                </div>
                <div className={styles.twBody}>
                  <div className={styles.twHeader}>
                    <span className={styles.twName}>Sotto</span>
                    <span><a href="https://x.com/sottofm" className={styles.twHandleLink}>@sottofm</a> &middot; 8m</span>
                  </div>
                  <div className={styles.twText}>Your podcast is ready! Listen now:</div>
                  {podcastUrl ? (
                    <a href={podcastUrl} className={styles.twCard}>
                      <div className={styles.twCardVisual}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
                          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                        </svg>
                      </div>
                      <div className={styles.twCardInfo}>
                        <span>sotto.fm</span>
                        <span>{podcastTitle}</span>
                        <span>{podcastDuration} &middot; 2 voices</span>
                      </div>
                    </a>
                  ) : (
                    <div className={styles.twCard}>
                      <div className={styles.twCardVisual}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
                          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                        </svg>
                      </div>
                      <div className={styles.twCardInfo}>
                        <span>sotto.fm</span>
                        <span>{podcastTitle}</span>
                        <span>{podcastDuration} &middot; 2 voices</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.features}>
              <div className={styles.feature}>{CHECK} Tag @sottofm in any tweet</div>
              <div className={styles.feature}>{CHECK} AI parses your topic automatically</div>
              <div className={styles.feature}>{CHECK} Replies with a direct link when ready</div>
            </div>
          </div>

          {/* Telegram column */}
          <div className={styles.column} data-reveal style={{ '--reveal-index': 1 } as React.CSSProperties}>
            <span className={styles.label}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
              Telegram
            </span>

            <div className={styles.tgMock}>
              <div className={`${styles.tgRow} ${styles.tgRowUser}`}>
                <div className={`${styles.tgBubble} ${styles.tgBubbleUser}`}>
                  I want a deep dive on {tgTopic}
                </div>
              </div>

              <div className={styles.tgRow}>
                <div className={styles.tgBotName}>
                  <a href="https://t.me/SottoFMBot" className={styles.tgBotLink}>SottoFM</a>
                </div>
                <div className={`${styles.tgBubble} ${styles.tgBubbleBot}`}>
                  Saved! You can turn this into a podcast anytime from your dashboard.
                </div>
              </div>

              <div className={`${styles.tgRow} ${styles.tgRowUser}`}>
                <div className={`${styles.tgBubble} ${styles.tgBubbleUser}`}>
                  Also save &quot;history of jazz&quot;
                </div>
              </div>

              <div className={styles.tgRow}>
                <div className={styles.tgBotName}>
                  <a href="https://t.me/SottoFMBot" className={styles.tgBotLink}>SottoFM</a>
                </div>
                <div className={`${styles.tgBubble} ${styles.tgBubbleBot}`}>
                  Saved! You now have 2 ideas waiting.
                </div>
              </div>
            </div>

            <div className={styles.features}>
              <div className={styles.feature}>{CHECK} Save ideas on the go</div>
              <div className={styles.feature}>{CHECK} Build a backlog of topics</div>
              <div className={styles.feature}>{CHECK} Turn any idea into a podcast from your dashboard</div>
            </div>
          </div>
        </div>
      </div>
    </ScrollChapter>
  );
}
