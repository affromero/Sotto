import type { LandingShowcaseData } from '@/lib/showcase';
import { ScrollChapter } from '../ScrollChapter';
import { ScriptEditorMock } from './ScriptEditorMock';
import styles from './JourneyChapter.module.css';

interface JourneyChapterProps {
  showcase: LandingShowcaseData | null;
}

const FEATURES = [
  'Mastery-gated CEFR courses across grammar, reading, listening, and speaking',
  'Adaptive listening lessons built around your topics and interests',
  'Pronunciation feedback with speaking exercises',
  'Personal vocabulary memory graph with spaced-repetition review',
  'Connect Claude Code, Codex, or any local agent via MCP',
  'Self-host on your own stack with your own keys and data',
];

export function JourneyChapter({ showcase }: JourneyChapterProps) {
  const chat = showcase?.chatMessages;
  const lastMsg = chat?.[chat.length - 1];
  const lastMsgChips = lastMsg?.role === 'assistant' ? lastMsg.chips : undefined;

  return (
    <ScrollChapter id="features" alt>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>How it works</span>
          <h2 className={styles.heading}>Your context. Your language course.</h2>
        </div>

        <div className={styles.stepsContainer}>
          {/* Step 1: Describe */}
          <div className={styles.split} data-reveal>
            <div className={styles.splitText}>
              <div className={styles.step}>
                <div className={styles.stepNum}>1</div>
                <div className={styles.stepBody}>
                  <h3 className={styles.stepTitle}>Connect your agent</h3>
                  <p className={styles.stepDesc}>
                    Plug in Claude Code, Codex, or another local agent via MCP. Sotto reads your
                    work context and places you at the right CEFR level to start.
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
                  {chat && chat.length > 0 ? (
                    <>
                      {chat.map((msg, i) => (
                        <div
                          key={i}
                          className={`${styles.mockMsg} ${msg.role === 'user' ? styles.mockUser : styles.mockBot}`}
                        >
                          {msg.role === 'assistant' && <div className={styles.mockAvatar}>S</div>}
                          <div className={styles.mockBubble}>{msg.content}</div>
                        </div>
                      ))}
                      <div className={styles.typingIndicator} aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      {lastMsgChips && lastMsgChips.length > 0 && (
                        <div className={styles.mockChips}>
                          {lastMsgChips.map((chip, i) => (
                            <span
                              key={i}
                              className={`${styles.chip} ${i > 0 ? styles.chipFaded : ''}`}
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className={`${styles.mockMsg} ${styles.mockUser}`}>
                        <div className={styles.mockBubble}>
                          I want to understand how CRISPR gene editing works
                        </div>
                      </div>
                      <div className={`${styles.mockMsg} ${styles.mockBot}`}>
                        <div className={styles.mockAvatar}>S</div>
                        <div className={styles.mockBubble}>
                          Fascinating topic! What&apos;s your background in biology?
                        </div>
                      </div>
                      <div className={`${styles.mockMsg} ${styles.mockUser}`}>
                        <div className={styles.mockBubble}>
                          Complete beginner, but I love science docs
                        </div>
                      </div>
                      <div className={`${styles.mockMsg} ${styles.mockBot}`}>
                        <div className={styles.mockAvatar}>S</div>
                        <div className={styles.mockBubble}>
                          Perfect. I&apos;ll use everyday analogies and build up from the basics.
                        </div>
                      </div>
                      <div className={styles.typingIndicator} aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </div>
                      <div className={styles.mockChips}>
                        <span className={styles.chip}>Complete beginner</span>
                        <span className={`${styles.chip} ${styles.chipFaded}`}>
                          Some college bio
                        </span>
                      </div>
                    </>
                  )}
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
                  <h3 className={styles.stepTitle}>Learn in your context</h3>
                  <p className={styles.stepDesc}>
                    Courses are built around the topics your agent already knows. Grammar, reading,
                    adaptive listening, and speaking — all using vocabulary from your real work and interests.
                  </p>
                </div>
              </div>
            </div>
            <div className={styles.splitVisual}>
              {showcase && showcase.scriptTurns.length > 0 ? (
                <ScriptEditorMock turns={showcase.scriptTurns} references={showcase.references} />
              ) : (
                <div className={styles.mockScript}>
                  <div className={styles.mockHeader}>
                    <div className={styles.mockDot} aria-hidden="true" />
                    <span>Script Editor</span>
                  </div>
                  <div className={styles.mockBody}>
                    <div className={styles.scriptTurn}>
                      <div className={styles.scriptLineRow}>
                        <span className={styles.lineNum}>1</span>
                        <div className={styles.scriptContent}>
                          <span className={styles.scriptSpeaker} data-speaker="host">
                            Host
                          </span>
                          <p>
                            Today we&apos;re diving into one of the most revolutionary technologies
                            of our time: CRISPR gene editing.{' '}
                            <sup className={styles.citation}>[1]</sup>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className={styles.scriptTurn}>
                      <div className={styles.scriptLineRow}>
                        <span className={styles.lineNum}>2</span>
                        <div className={styles.scriptContent}>
                          <span className={styles.scriptSpeaker} data-speaker="expert">
                            Expert
                          </span>
                          <p>
                            Think of CRISPR as molecular scissors that can cut DNA at precisely the
                            right spot. It&apos;s based on a natural defense system that bacteria
                            use. <sup className={styles.citation}>[2]</sup>
                          </p>
                        </div>
                      </div>
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
              )}
            </div>
          </div>
        </div>

        {/* Compact feature list replacing NetworkChapter's 9 cards */}
        <ul className={styles.featureList} data-reveal>
          {FEATURES.map((feature) => (
            <li key={feature} className={styles.featureItem}>
              <span className={styles.featureDot} aria-hidden="true" />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </ScrollChapter>
  );
}
