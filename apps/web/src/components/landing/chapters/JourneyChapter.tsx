import { ScrollChapter } from '../ScrollChapter';
import styles from './JourneyChapter.module.css';

export function JourneyChapter() {
  return (
    <ScrollChapter id="features" alt>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>How it works</span>
          <h2 className={styles.heading}>Three steps. One incredible podcast.</h2>
        </div>

        {/* Step 1: Describe */}
        <div className={styles.split} data-reveal>
          <div className={styles.splitText}>
            <div className={styles.step}>
              <div className={styles.stepNum}>1</div>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>Describe your topic</h3>
                <p className={styles.stepDesc}>
                  Chat with Sotto about what you want to learn. AI researches your topic,
                  writes a script with citations, and verifies every claim.
                </p>
              </div>
            </div>
          </div>
          <div className={styles.splitVisual}>
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
        </div>

        {/* Step 2: Review (reversed layout) */}
        <div className={`${styles.split} ${styles.splitReverse}`} data-reveal>
          <div className={styles.splitText}>
            <div className={styles.step}>
              <div className={styles.stepNum}>2</div>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>Review &amp; choose voices</h3>
                <p className={styles.stepDesc}>
                  Edit every line of the script. Pick from 7 TTS providers &mdash;
                  ElevenLabs, Cartesia, Hume, OpenAI, and more &mdash; or use your
                  cloned voice.
                </p>
              </div>
            </div>
          </div>
          <div className={styles.splitVisual}>
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
        </div>

        {/* Step 3: Listen */}
        <div className={styles.split} data-reveal>
          <div className={styles.splitText}>
            <div className={styles.step}>
              <div className={styles.stepNum}>3</div>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>Listen, share, or create video</h3>
                <p className={styles.stepDesc}>
                  Publish to the social feed, fork any public podcast, generate a full video
                  with AI illustrations and avatar presenters, or ask questions mid-playback.
                </p>
              </div>
            </div>
          </div>
          <div className={styles.splitVisual}>
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

        {/* Connecting line between steps */}
        <div className={styles.stepLine} aria-hidden="true" />
      </div>
    </ScrollChapter>
  );
}
