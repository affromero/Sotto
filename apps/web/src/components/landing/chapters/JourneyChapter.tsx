'use client';

import { useEffect, useRef } from 'react';
import { ScrollChapter } from '../ScrollChapter';
import styles from './JourneyChapter.module.css';

const STEPS = [
  {
    num: '1',
    title: 'Describe your topic',
    description:
      'Chat with Sotto about what you want to learn. AI researches your topic, writes a script with citations, and verifies every claim.',
    visual: 'describe',
  },
  {
    num: '2',
    title: 'Review & choose voices',
    description:
      'Edit every line of the script. Pick from 7 TTS providers — ElevenLabs, Cartesia, Hume, OpenAI, and more — or use your cloned voice.',
    visual: 'script',
  },
  {
    num: '3',
    title: 'Listen, share, or create video',
    description:
      'Publish to the social feed, fork any public podcast, generate a full video with AI illustrations and avatar presenters, or ask questions mid-playback.',
    visual: 'listen',
  },
];

export function JourneyChapter() {
  const stepsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stepsRef.current.forEach((el) => el?.setAttribute('data-active', ''));
      return;
    }

    // On mobile, skip sticky — use standard data-reveal
    if (window.innerWidth < 768) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          el.toggleAttribute('data-active', entry.isIntersecting);
        }
      },
      { threshold: 0.5 }
    );

    stepsRef.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <ScrollChapter id="features" alt>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>How it works</span>
          <h2 className={styles.heading}>Three steps. One incredible podcast.</h2>
        </div>

        <div className={styles.scrollContainer}>
          {/* Left: text steps */}
          <div className={styles.stepsColumn}>
            {STEPS.map((step, i) => (
              <div
                key={step.num}
                ref={(el) => { stepsRef.current[i] = el; }}
                className={styles.stepTrigger}
                data-reveal
              >
                <div className={styles.step}>
                  <div className={styles.stepNum}>{step.num}</div>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepDesc}>{step.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: sticky visual */}
          <div className={styles.visualColumn}>
            <div className={styles.visualSticky}>
              {/* Describe visual */}
              <div className={`${styles.visual} ${styles.visualDescribe}`} data-step="describe">
                <div className={styles.mockChat}>
                  <div className={styles.mockHeader}>
                    <div className={styles.mockDot} aria-hidden="true" />
                    <span>Sotto Discovery</span>
                  </div>
                  <div className={styles.mockBody}>
                    <div className={`${styles.mockMsg} ${styles.mockUser}`}>
                      <div className={styles.mockBubble}>
                        I want to understand how CRISPR gene editing works
                      </div>
                    </div>
                    <div className={`${styles.mockMsg} ${styles.mockBot}`}>
                      <div className={styles.mockAvatar}>S</div>
                      <div className={styles.mockBubble}>
                        Fascinating topic! To tailor this for you &mdash; what&apos;s your
                        background in biology?
                      </div>
                    </div>
                    <div className={styles.mockChips}>
                      <span className={styles.chip}>Complete beginner</span>
                      <span className={`${styles.chip} ${styles.chipFaded}`}>Some college bio</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Script visual */}
              <div className={`${styles.visual} ${styles.visualScript}`} data-step="script">
                <div className={styles.mockScript}>
                  <div className={styles.mockHeader}>
                    <div className={styles.mockDot} aria-hidden="true" />
                    <span>Script Editor</span>
                  </div>
                  <div className={styles.mockBody}>
                    <div className={styles.scriptTurn}>
                      <span className={styles.scriptSpeaker} data-speaker="host">Host</span>
                      <p>
                        Today we&apos;re diving into one of the most revolutionary technologies
                        of our time &mdash; CRISPR gene editing. [1]
                      </p>
                    </div>
                    <div className={styles.scriptTurn}>
                      <span className={styles.scriptSpeaker} data-speaker="expert">Expert</span>
                      <p>
                        Think of CRISPR as molecular scissors that can cut DNA at precisely
                        the right spot. It&apos;s based on a natural defense system that
                        bacteria use. [2]
                      </p>
                    </div>
                    <div className={styles.scriptActions}>
                      <span className={styles.scriptBtn}>Edit</span>
                      <span className={styles.scriptBtn}>Regenerate</span>
                      <span className={`${styles.scriptBtn} ${styles.scriptBtnPrimary}`}>
                        Generate Audio
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Listen visual */}
              <div className={`${styles.visual} ${styles.visualListen}`} data-step="listen">
                <div className={styles.mockPlayer}>
                  <div className={styles.mockHeader}>
                    <div className={styles.mockDot} aria-hidden="true" />
                    <span>Now Playing</span>
                  </div>
                  <div className={styles.mockBody}>
                    <div className={styles.playerTitle}>CRISPR Gene Editing Explained</div>
                    <div className={styles.playerMeta}>10 min &middot; 2 voices &middot; 8 sources</div>
                    <div className={styles.playerWaveform}>
                      {Array.from({ length: 32 }, (_, i) => (
                        <span key={i} className={styles.playerBar} style={{ '--i': i } as React.CSSProperties} />
                      ))}
                    </div>
                    <div className={styles.playerControls}>
                      <span className={styles.playerTime}>3:42 / 10:15</span>
                      <div className={styles.playerActions}>
                        <span className={styles.playerAction}>Fork</span>
                        <span className={styles.playerAction}>Video</span>
                        <span className={styles.playerAction}>Share</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollChapter>
  );
}
