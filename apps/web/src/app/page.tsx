import Link from 'next/link';
import { BRAND } from '@sotto/shared';
import { LandingShell } from '@/components/landing/LandingShell';
import { LandingNav } from '@/components/landing/LandingNav';
import { WaitlistProvider } from '@/components/landing/WaitlistProvider';
import { AuthCTA } from '@/components/landing/AuthCTA';
import { PoweredByProviders } from '@/components/landing/PoweredByProviders';
import { JsonLd } from '@/components/landing/JsonLd';
import styles from './page.module.css';

const VOICE_TRAITS = [
  { trait: 'Warm narrator', accent: 'American', icon: '\u266A' },
  { trait: 'Calm & authoritative', accent: 'American', icon: '\u25CE' },
  { trait: 'Distinguished professor', accent: 'British', icon: '\u273B' },
  { trait: 'Witty & sharp', accent: 'British', icon: '\u2726' },
  { trait: 'Upbeat storyteller', accent: 'American', icon: '\u2606' },
  { trait: 'Polished professional', accent: 'British', icon: '\u25C7' },
  { trait: 'Casual & curious', accent: 'Australian', icon: '\u223F' },
  { trait: 'Warm & approachable', accent: 'Australian', icon: '\u2B50' },
];

export default function LandingPage() {
  return (
    <WaitlistProvider>
    <LandingShell>
      <JsonLd />
      <LandingNav />

      {/* ====== HERO ====== */}
      <section className={styles.hero} aria-label="Introduction">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            {BRAND.tagline}
          </div>
          <h1 className={styles.heroTitle}>
            Any topic.
            <br />
            <em>Studio-quality podcast.</em>
          </h1>
          <p className={styles.heroSub}>
            Sotto writes a fact-checked script &mdash; dialogue, monologue, or panel &mdash;
            generates audio with professional AI voices from 7 providers, and turns it
            into video. All in minutes.
          </p>
          <AuthCTA source="hero" />
        </div>
        <div className={styles.heroWave} aria-hidden="true">
          {Array.from({ length: 64 }, (_, i) => (
            <span key={i} className={styles.bar} style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
      </section>

      {/* ====== CORE CAPABILITIES ====== */}
      <section className={styles.section} id="features" aria-label="Core capabilities">
        <div className={styles.inner}>
          <h2 className={styles.srOnly}>Core Capabilities</h2>
          <div className={styles.pillars}>
            <article className={styles.pillar} data-reveal>
              <div className={styles.pIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M9 15l2 2 4-4" />
                </svg>
              </div>
              <h3>AI Script Generation</h3>
              <p>
                Describe any topic. Sotto researches, writes a script &mdash; dialogue,
                monologue, or panel &mdash; with citations and fact-checks every claim
                through multiple verification loops. Review and edit every line before
                generating.
              </p>
            </article>
            <article className={styles.pillar} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={`${styles.pIcon} ${styles.pIconNavy}`}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                </svg>
              </div>
              <h3>7 Voice Providers</h3>
              <p>
                ElevenLabs, Cartesia, Hume, OpenAI, and more &mdash; or clone your own
                voice. Dialogue, monologue, panel &mdash; every format gets voices matched
                by tone, accent, and style.
              </p>
            </article>
            <article className={styles.pillar} data-reveal style={{ "--reveal-index": 2 } as React.CSSProperties}>
              <div className={styles.pIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <h3>Video Generation</h3>
              <p>
                Turn any podcast into video with AI illustrations, animated data charts,
                stock footage, timelines, and lip-synced avatar presenters. Control the
                visual style for every segment.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ====== DEMO ====== */}
      <section className={`${styles.section} ${styles.sectionAlt}`} aria-label="Product demo">
        <div className={styles.inner}>
          <div className={styles.split}>
            <div className={styles.splitText} data-reveal>
              <span className={styles.overline}>See it in action</span>
              <h2 className={styles.h2}>From curiosity to podcast in under a minute</h2>
              <p className={styles.bodyLg}>
                Describe what you want to learn. Sotto chats with you to understand your background
                and interests, then crafts a podcast that feels like it was made by your favorite
                producers.
              </p>
            </div>
            <div className={styles.splitVisual} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={styles.chatMock}>
                <div className={styles.chatHeader}>
                  <div className={styles.chatHeaderDot} aria-hidden="true" />
                  <span>Sotto Discovery</span>
                </div>
                <div className={styles.chatBody}>
                  <div className={`${styles.chatMsg} ${styles.chatUser}`}>
                    <div className={styles.chatBubble}>
                      I want to understand how CRISPR gene editing works
                    </div>
                  </div>
                  <div className={`${styles.chatMsg} ${styles.chatBot}`}>
                    <div className={styles.chatAvatar} aria-hidden="true">
                      S
                    </div>
                    <div className={styles.chatBubble}>
                      Fascinating topic! To tailor this for you — what&apos;s your background in
                      biology?
                    </div>
                  </div>
                  <div className={styles.chatChips}>
                    <span className={styles.chip}>Complete beginner</span>
                    <span className={`${styles.chip} ${styles.chipFaded}`}>Some college bio</span>
                    <span className={`${styles.chip} ${styles.chipFaded}`}>
                      Research background
                    </span>
                  </div>
                  <div className={`${styles.chatMsg} ${styles.chatUser}`}>
                    <div className={styles.chatBubble}>Complete beginner</div>
                  </div>
                  <div className={`${styles.chatMsg} ${styles.chatBot}`}>
                    <div className={styles.chatAvatar} aria-hidden="true">
                      S
                    </div>
                    <div className={styles.chatBubble}>
                      Perfect. Should we focus on the science, the ethics, or both?
                    </div>
                  </div>
                  <div className={`${styles.chatMsg} ${styles.chatUser}`}>
                    <div className={styles.chatBubble}>Both — that sounds great</div>
                  </div>
                  <div className={styles.chatGenerating}>
                    <div className={styles.chatSpinner} aria-hidden="true" />
                    Generating your podcast...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== TRUST STRIP ====== */}
      <div className={styles.trustStrip} data-reveal aria-label="Verification promise">
        <div className={styles.trustStripInner}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.trustStripIcon}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span>Every claim fact-checked. Every source verified. No hallucinations.</span>
          <a href="#verification" className={styles.trustStripLink}>
            See how
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17l9.2-9.2M17 17V8H8" />
            </svg>
          </a>
        </div>
      </div>

      {/* ====== VIDEO SHOWCASE ====== */}
      <section className={styles.section} aria-label="Video generation">
        <div className={styles.inner}>
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <div className={styles.splitText} data-reveal>
              <span className={styles.overline}>Video Pipeline</span>
              <h2 className={styles.h2}>From podcast to video in one click</h2>
              <p className={styles.bodyLg}>
                Every segment gets classified and paired with the right visual &mdash;
                AI-generated illustrations, animated data charts, stock footage, or comparison
                diagrams. Add lip-synced avatar presenters for a professional studio look.
              </p>
            </div>
            <div className={styles.splitVisual} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={styles.videoMock}>
                <div className={styles.videoMockHeader}>
                  <div className={styles.chatHeaderDot} aria-hidden="true" />
                  <span>Video Pipeline</span>
                </div>
                <div className={styles.videoSegments}>
                  <div className={styles.videoSegment}>
                    <span className={styles.videoSegmentNum}>1</span>
                    <div className={styles.videoSegmentContent}>
                      <span className={styles.videoSegmentLabel}>
                        CRISPR molecular scissors
                      </span>
                    </div>
                    <span className={`${styles.videoSegmentType} ${styles.videoTypeIllustration}`}>
                      AI Illustration
                    </span>
                  </div>
                  <div className={styles.videoSegment}>
                    <span className={styles.videoSegmentNum}>2</span>
                    <div className={styles.videoSegmentContent}>
                      <span className={styles.videoSegmentLabel}>
                        Gene therapy success rates
                      </span>
                    </div>
                    <span className={`${styles.videoSegmentType} ${styles.videoTypeChart}`}>
                      Data Chart
                    </span>
                  </div>
                  <div className={styles.videoSegment}>
                    <span className={styles.videoSegmentNum}>3</span>
                    <div className={styles.videoSegmentContent}>
                      <span className={styles.videoSegmentLabel}>
                        Laboratory research setting
                      </span>
                    </div>
                    <span className={`${styles.videoSegmentType} ${styles.videoTypeStock}`}>
                      Stock Footage
                    </span>
                  </div>
                  <div className={styles.videoSegment}>
                    <span className={styles.videoSegmentNum}>4</span>
                    <div className={styles.videoSegmentContent}>
                      <span className={styles.videoSegmentLabel}>
                        Key milestones in gene editing
                      </span>
                    </div>
                    <span className={`${styles.videoSegmentType} ${styles.videoTypeTimeline}`}>
                      Timeline
                    </span>
                  </div>
                </div>
                <div className={styles.videoMockFooter}>
                  <div className={styles.videoAvatarToggle}>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    Avatars: On
                  </div>
                  <span className={styles.videoVisualCount}>9 visual types</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== VOICES ====== */}
      <section
        className={`${styles.section} ${styles.sectionAlt}`}
        id="voices"
        aria-label="Voice selection"
      >
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overline}>Voices</span>
            <h2 className={styles.h2}>Every podcast sounds different. By design.</h2>
            <p className={styles.bodyLg}>
              Choose from 7 TTS providers &mdash; ElevenLabs, Cartesia, Hume, OpenAI, Fal, MiniMax,
              and Replicate &mdash; or clone your own voice. Dialogues, monologues, panels &mdash;
              every format gets voices matched for natural, engaging conversation.
            </p>
          </div>
          <div className={styles.voiceGrid}>
            {VOICE_TRAITS.map((v, i) => (
              <div
                key={v.trait}
                className={styles.voiceCard} data-reveal
                style={{ '--vi': i } as React.CSSProperties}
              >
                <div className={`${styles.voiceAvatar} ${i % 2 !== 0 ? styles.voiceAvatarF : ''}`}>
                  {v.icon}
                </div>
                <div className={styles.voiceInfo}>
                  <span className={styles.voiceName}>{v.trait}</span>
                </div>
                <span className={styles.voiceAccent}>{v.accent}</span>
              </div>
            ))}
          </div>
          <div className={styles.voicePairing} data-reveal>
            <div className={styles.pairingExample}>
              <div className={`${styles.pairingRole} ${styles.pairingHost}`}>
                <span className={styles.pairingDot} />
                Speaker A
              </div>
              <div className={styles.pairingLine} aria-hidden="true" />
              <div className={styles.pairingLabel}>contrasting voices</div>
              <div className={styles.pairingLine} aria-hidden="true" />
              <div className={`${styles.pairingRole} ${styles.pairingExpert}`}>
                <span className={styles.pairingDot} />
                Speaker B
              </div>
            </div>
            <p className={styles.pairingHint}>
              Sotto automatically pairs voices with different genders, accents, or tones for
              auditory contrast &mdash; whether it&apos;s a dialogue, panel, or solo narration.
              Or pick your own combination.
            </p>
          </div>
        </div>
      </section>

      {/* ====== VOICE SHARING ====== */}
      <section className={styles.section} aria-label="Voice cloning and sharing">
        <div className={styles.inner}>
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <div className={styles.splitText} data-reveal>
              <span className={styles.overline}>Voice Sharing</span>
              <h2 className={styles.h2}>Clone your voice. Share it — or sell it.</h2>
              <p className={styles.bodyLg}>
                Upload a sample and Sotto clones your voice in seconds. Share it for free or set
                a per-podcast price — we handle payments, you get paid. Anyone on the network can
                request access or purchase your voice for their podcasts.
              </p>
              <div className={styles.forkFeatures}>
                <div className={styles.forkFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M13 7v1a5 5 0 0 1-10 0V7" />
                    <path d="M8 13v2" />
                  </svg>
                  <span>Clone from any audio sample</span>
                </div>
                <div className={styles.forkFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M11 1H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2z" />
                    <path d="M8 11h.01" />
                  </svg>
                  <span>Toggle sharing on or off anytime</span>
                </div>
                <div className={styles.forkFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5" />
                    <path d="M14 3H2" />
                    <path d="M6 1h4" />
                  </svg>
                  <span>Approve or deny every request</span>
                </div>
                <div className={styles.forkFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="8" r="7" />
                    <path d="M5.5 8l2 2 3.5-4" />
                  </svg>
                  <span>Set your own price — or keep it free</span>
                </div>
              </div>
            </div>
            <div className={styles.splitVisual} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={styles.voiceSharingMock}>
                <div className={styles.vsMockHeader}>
                  <span className={styles.vsMockTitle}>My Voice Clones</span>
                  <span className={styles.vsMockCount}>2 of 10</span>
                </div>
                <div className={styles.vsMockVoice}>
                  <div className={styles.vsMockVoiceLeft}>
                    <div className={styles.vsMockAvatar}>A</div>
                    <div className={styles.vsMockVoiceInfo}>
                      <span className={styles.vsMockVoiceName}>Andres&apos;s Voice</span>
                      <span className={styles.vsMockVoiceMeta}>Uploaded · Warm baritone</span>
                    </div>
                  </div>
                  <div className={styles.vsMockPriceTag}>$2.00 / podcast</div>
                </div>
                <div className={styles.vsMockRequest}>
                  <div className={styles.vsMockRequestDot} aria-hidden="true" />
                  <div className={styles.vsMockRequestInfo}>
                    <span className={styles.vsMockRequestText}>
                      <strong>@sarah</strong> wants to use your voice
                    </span>
                    <span className={styles.vsMockRequestMsg}>
                      &ldquo;Love your tone — perfect for my science series!&rdquo;
                    </span>
                  </div>
                  <div className={styles.vsMockRequestActions}>
                    <span className={styles.vsMockBtnApprove}>Approve</span>
                    <span className={styles.vsMockBtnDeny}>Deny</span>
                  </div>
                </div>
                <div className={styles.vsMockUsedBy}>
                  <span className={styles.vsMockUsedByLabel}>Currently used by</span>
                  <div className={styles.vsMockUsedByAvatars}>
                    <span className={styles.vsMockUsedByAvatar}>S</span>
                    <span className={styles.vsMockUsedByAvatar}>M</span>
                    <span className={styles.vsMockUsedByAvatar}>J</span>
                    <span className={styles.vsMockUsedByCount}>+2 others</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== SOCIAL ====== */}
      <section className={`${styles.section} ${styles.sectionAlt}`} aria-label="Social features">
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overline}>Community</span>
            <h2 className={styles.h2}>Fork, import, remix</h2>
            <p className={styles.bodyLg}>
              Sotto is a social podcast network. Build on what others started, bring in podcasts from
              anywhere, and interact with every episode.
            </p>
          </div>
          <div className={styles.pillars}>
            <article className={styles.pillar} data-reveal>
              <div className={styles.pIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="7" cy="5" r="3" />
                  <circle cx="7" cy="19" r="3" />
                  <circle cx="19" cy="12" r="3" />
                  <path d="M7 8v8M10 19h6a3 3 0 0 0 0-6h-6" />
                </svg>
              </div>
              <h3>Fork &amp; Remix</h3>
              <p>
                Found a podcast you love? Fork it. Change the angle, swap voices, go deeper on a
                subtopic. Credit always links back to the original.
              </p>
            </article>
            <article className={styles.pillar} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={`${styles.pIcon} ${styles.pIconNavy}`}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <h3>Import Any Podcast</h3>
              <p>
                Bring podcasts from NotebookLM, Spotify, Apple Podcasts, YouTube, or any audio
                file. Sotto adds transcripts, social features, and interactive Q&amp;A.
              </p>
            </article>
            <article className={styles.pillar} data-reveal style={{ "--reveal-index": 2 } as React.CSSProperties}>
              <div className={styles.pIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3>Ask Questions Live</h3>
              <p>
                Pause mid-playback to ask a follow-up. Get an answer drawn from the full context.
                Your Q&amp;A gets woven back into the episode permanently.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ====== BOT INTEGRATIONS ====== */}
      <section className={styles.botSection} aria-label="Bot integrations">
        <div className={styles.botGlow} aria-hidden="true" />
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overlineLight}>Generate from anywhere</span>
            <h2 className={styles.h2Light}>Tweet it. Message it. Done.</h2>
            <p className={styles.bodyLgLight}>
              Tag <strong>@sottofm</strong> on X or message <strong>@SottoFMBot</strong> on
              Telegram to save a topic, URL, or video as a podcast idea — then open Sotto to generate.
            </p>
          </div>

          <div className={styles.botGrid} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
            {/* Twitter / X column */}
            <div className={styles.botColumn}>
              <span className={styles.botLabel}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                X (Twitter)
                <span className={styles.srOnly}>X, formerly Twitter</span>
              </span>

              <div className={styles.twMock}>
                {/* User tweet */}
                <div className={styles.twPost}>
                  <div className={styles.twPostLeft}>
                    <div className={styles.twAvatar}>A</div>
                    <div className={styles.twThread} />
                  </div>
                  <div className={styles.twPostBody}>
                    <div className={styles.twPostHeader}>
                      <span className={styles.twName}>Andres</span>
                      <span>@andres · 2m</span>
                    </div>
                    <div className={styles.twText}>
                      <span className={styles.twMention}>@sottofm</span> make a podcast about the
                      psychology of decision-making
                    </div>
                    <div className={styles.twActions}>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </span>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M17 1l4 4-4 4" />
                          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                          <path d="M7 23l-4-4 4-4" />
                          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                        </svg>
                      </span>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      </span>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                          <polyline points="16 6 12 2 8 6" />
                          <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>

                {/* @sottofm reply */}
                <div className={`${styles.twPost} ${styles.twPostSotto}`}>
                  <div className={styles.twPostLeft}>
                    <div className={styles.twAvatarSotto}>S</div>
                  </div>
                  <div className={styles.twPostBody}>
                    <div className={styles.twPostHeader}>
                      <span className={styles.twName}>Sotto</span>
                      <span>@sottofm · 8m</span>
                    </div>
                    <div className={styles.twText}>Your podcast is ready! Listen now:</div>
                    <div className={styles.twCard}>
                      <div className={styles.twCardVisual}>
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#fff"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                        </svg>
                      </div>
                      <div className={styles.twCardInfo}>
                        <span>sotto.fm</span>
                        <span>The Psychology of Decision-Making</span>
                        <span>10 min · multi-voice</span>
                      </div>
                    </div>
                    <div className={styles.twActions}>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </span>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M17 1l4 4-4 4" />
                          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                          <path d="M7 23l-4-4 4-4" />
                          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                        </svg>
                      </span>
                      <span className={styles.twHeartActive}>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      </span>
                      <span>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                          <polyline points="16 6 12 2 8 6" />
                          <line x1="12" y1="2" x2="12" y2="15" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.twFeatures}>
                <div className={styles.twFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Tag @sottofm in any tweet
                </div>
                <div className={styles.twFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  AI parses your topic automatically
                </div>
                <div className={styles.twFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Replies with a direct link when ready
                </div>
              </div>
            </div>

            {/* Telegram column */}
            <div className={styles.botColumn}>
              <span className={styles.botLabel}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                Telegram
                <span className={styles.srOnly}>Telegram messaging app</span>
              </span>

              <div className={styles.tgMock}>
                <div className={`${styles.tgMsgRow} ${styles.tgMsgRowUser}`}>
                  <div className={`${styles.tgBubble} ${styles.tgBubbleUser}`}>
                    https://nature.com/articles/quantum-computing-2026
                  </div>
                </div>

                <div className={styles.tgMsgRow}>
                  <div className={styles.tgBotName}>SottoFM</div>
                  <div className={`${styles.tgBubble} ${styles.tgBubbleBot}`}>
                    Saved as a podcast idea! Open Sotto to generate your podcast.
                  </div>
                </div>

                <div className={styles.tgKeyboard}>
                  <span className={styles.tgKeyUrl}>Open Sotto ↗</span>
                </div>

                <div className={styles.tgMsgRow}>
                  <div className={styles.tgBotName}>SottoFM</div>
                  <div className={`${styles.tgBubble} ${styles.tgBubbleBot}`}>
                    Your podcast is ready! &quot;Quantum Computing in 2026&quot; (10 min)
                  </div>
                </div>

                <div className={styles.tgKeyboard}>
                  <span className={styles.tgKeyUrl}>Listen Now ↗</span>
                </div>
              </div>

              <div className={styles.tgFeatures}>
                <div className={styles.tgFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Save any topic, URL, or video on the go
                </div>
                <div className={styles.tgFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Get notified when your podcast is ready
                </div>
                <div className={styles.tgFeature}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Open Sotto to generate from your saved ideas
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== USE CASES ====== */}
      <section className={styles.section} aria-label="Use cases">
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overline}>Built for the curious</span>
            <h2 className={styles.h2}>Turn any topic into a podcast worth sharing</h2>
          </div>
          <div className={styles.useCases}>
            <article className={styles.useCase} data-reveal>
              <div className={styles.useCaseIcon} aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
              <h3>Students</h3>
              <p>
                Turn dense research papers into digestible conversations. Study smarter by listening
                and asking questions in real time.
              </p>
            </article>
            <article className={styles.useCase} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={styles.useCaseIcon} aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                </svg>
              </div>
              <h3>Professionals</h3>
              <p>
                Stay current on industry trends during your commute. Get up to speed on any subject
                in 10 focused minutes.
              </p>
            </article>
            <article className={styles.useCase} data-reveal style={{ "--reveal-index": 2 } as React.CSSProperties}>
              <div className={styles.useCaseIcon} aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3>Educators</h3>
              <p>
                Create engaging supplementary material for your students. Interactive audio that
                adapts to every learner.
              </p>
            </article>
            <article className={styles.useCase} data-reveal style={{ "--reveal-index": 3 } as React.CSSProperties}>
              <div className={styles.useCaseIcon} aria-hidden="true">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <h3>Researchers</h3>
              <p>
                Make your work accessible to a wider audience. Transform complex findings into
                compelling conversations anyone can follow.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ====== HOW IT WORKS ====== */}
      <section className={`${styles.section} ${styles.sectionAlt}`} aria-label="How it works">
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overline}>How it works</span>
            <h2 className={styles.h2}>Three steps. One incredible podcast.</h2>
          </div>
          <div className={styles.steps}>
            <div className={styles.step} data-reveal>
              <div className={styles.stepNum}>1</div>
              <div className={styles.stepContent}>
                <h3>Describe your topic</h3>
                <p>
                  Chat with Sotto about what you want to learn. AI researches your topic, writes a
                  script with citations, and verifies every claim.
                </p>
              </div>
            </div>
            <div className={styles.stepLine} aria-hidden="true" />
            <div className={styles.step} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
              <div className={styles.stepNum}>2</div>
              <div className={styles.stepContent}>
                <h3>Choose voices and generate</h3>
                <p>
                  Pick from 7 TTS providers &mdash; ElevenLabs, Cartesia, Hume, and more &mdash;
                  or use your cloned voice. Sotto generates studio-quality audio with distinct
                  voices matched to your format.
                </p>
              </div>
            </div>
            <div className={styles.stepLine} aria-hidden="true" />
            <div className={styles.step} data-reveal style={{ "--reveal-index": 2 } as React.CSSProperties}>
              <div className={styles.stepNum}>3</div>
              <div className={styles.stepContent}>
                <h3>Share, fork, or create video</h3>
                <p>
                  Publish to the social feed, fork any public podcast, or generate a full video
                  with AI illustrations, data charts, and avatar presenters.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== OPEN VERIFICATION STANDARD ====== */}
      <section id="verification" className={styles.section} aria-label="Open verification standard">
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overline}>Open Verification Standard</span>
            <div className={styles.verificationV2Row}>
              <span className={styles.verificationV2Pill}>Bayesian v2</span>
            </div>
            <h2 className={styles.h2}>Domain-aware. Claim-level. Open source.</h2>
            <p className={styles.bodyLg}>
              Every reference is scored by its domain &mdash; because news articles don&apos;t need
              DOIs, and Wikipedia isn&apos;t held to the same bar as Nature.
            </p>
          </div>

          <div className={styles.verificationGrid} data-reveal style={{ "--reveal-index": 1 } as React.CSSProperties}>
            {/* ACADEMIC */}
            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#1E3A5F',
                  '--verification-bg': 'rgba(30, 58, 95, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHead}>
                <div className={styles.verificationCardMeta}>
                  <span className={styles.verificationDomain}>Academic</span>
                  <div className={styles.verificationThresholds}>
                    <span className={styles.verificationThreshold}>&ge; 0.70</span>
                    <span className={styles.verificationThresholdV2}>Bayes &ge; 82%</span>
                  </div>
                </div>
                <svg
                  viewBox="0 0 52 52"
                  className={styles.verificationPriorSvg}
                  aria-label="72% Bayesian prior — starting confidence before any checks"
                >
                  <circle cx="26" cy="26" r="20" className={styles.verificationPriorTrack} />
                  <circle
                    cx="26" cy="26" r="20"
                    className={styles.verificationPriorFill}
                    style={{ stroke: '#1E3A5F', strokeDashoffset: 35.18 }}
                    transform="rotate(-90 26 26)"
                  />
                  <text x="26" y="24" textAnchor="middle" dominantBaseline="central" className={styles.verificationPriorPct}>72%</text>
                  <text x="26" y="36" textAnchor="middle" className={styles.verificationPriorLbl}>prior</text>
                </svg>
              </div>
              <p className={styles.verificationDesc}>
                Peer-reviewed papers, preprints, books. DOI and academic indexing carry most weight.
              </p>
              <div className={styles.verificationFormula}>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>DOI</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '45%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>45%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>Title search</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '30%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>30%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>URL</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '10%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>10%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>AI</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '15%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>15%</span>
                </div>
              </div>
            </div>

            {/* NEWS */}
            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#D97706',
                  '--verification-bg': 'rgba(217, 119, 6, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHead}>
                <div className={styles.verificationCardMeta}>
                  <span className={styles.verificationDomain}>News</span>
                  <div className={styles.verificationThresholds}>
                    <span className={styles.verificationThreshold}>&ge; 0.50</span>
                    <span className={styles.verificationThresholdV2}>Bayes &ge; 65%</span>
                  </div>
                </div>
                <svg
                  viewBox="0 0 52 52"
                  className={styles.verificationPriorSvg}
                  aria-label="75% Bayesian prior — starting confidence before any checks"
                >
                  <circle cx="26" cy="26" r="20" className={styles.verificationPriorTrack} />
                  <circle
                    cx="26" cy="26" r="20"
                    className={styles.verificationPriorFill}
                    style={{ stroke: '#D97706', strokeDashoffset: 31.42 }}
                    transform="rotate(-90 26 26)"
                  />
                  <text x="26" y="24" textAnchor="middle" dominantBaseline="central" className={styles.verificationPriorPct}>75%</text>
                  <text x="26" y="36" textAnchor="middle" className={styles.verificationPriorLbl}>prior</text>
                </svg>
              </div>
              <p className={styles.verificationDesc}>
                Established outlets &mdash; NYT, Reuters, BBC. AI judges outlet credibility and
                claim support.
              </p>
              <div className={styles.verificationFormula}>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>URL</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '35%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>35%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>AI</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '65%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>65%</span>
                </div>
              </div>
            </div>

            {/* GOVERNMENT */}
            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#16A34A',
                  '--verification-bg': 'rgba(22, 163, 74, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHead}>
                <div className={styles.verificationCardMeta}>
                  <span className={styles.verificationDomain}>Government</span>
                  <div className={styles.verificationThresholds}>
                    <span className={styles.verificationThreshold}>&ge; 0.55</span>
                    <span className={styles.verificationThresholdV2}>Bayes &ge; 72%</span>
                  </div>
                </div>
                <svg
                  viewBox="0 0 52 52"
                  className={styles.verificationPriorSvg}
                  aria-label="82% Bayesian prior — starting confidence before any checks"
                >
                  <circle cx="26" cy="26" r="20" className={styles.verificationPriorTrack} />
                  <circle
                    cx="26" cy="26" r="20"
                    className={styles.verificationPriorFill}
                    style={{ stroke: '#16A34A', strokeDashoffset: 22.62 }}
                    transform="rotate(-90 26 26)"
                  />
                  <text x="26" y="24" textAnchor="middle" dominantBaseline="central" className={styles.verificationPriorPct}>82%</text>
                  <text x="26" y="36" textAnchor="middle" className={styles.verificationPriorLbl}>prior</text>
                </svg>
              </div>
              <p className={styles.verificationDesc}>
                Official sources &mdash; .gov, WHO, UN. Verified against official domain patterns.
              </p>
              <div className={styles.verificationFormula}>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>URL</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '40%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>40%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>AI</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '60%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>60%</span>
                </div>
              </div>
            </div>

            {/* GENERAL */}
            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#6B7280',
                  '--verification-bg': 'rgba(107, 114, 128, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHead}>
                <div className={styles.verificationCardMeta}>
                  <span className={styles.verificationDomain}>General</span>
                  <div className={styles.verificationThresholds}>
                    <span className={styles.verificationThreshold}>&ge; 0.55</span>
                    <span className={styles.verificationThresholdV2}>Bayes &ge; 68%</span>
                  </div>
                </div>
                <svg
                  viewBox="0 0 52 52"
                  className={styles.verificationPriorSvg}
                  aria-label="45% Bayesian prior — starting confidence before any checks"
                >
                  <circle cx="26" cy="26" r="20" className={styles.verificationPriorTrack} />
                  <circle
                    cx="26" cy="26" r="20"
                    className={styles.verificationPriorFill}
                    style={{ stroke: '#6B7280', strokeDashoffset: 69.11 }}
                    transform="rotate(-90 26 26)"
                  />
                  <text x="26" y="24" textAnchor="middle" dominantBaseline="central" className={styles.verificationPriorPct}>45%</text>
                  <text x="26" y="36" textAnchor="middle" className={styles.verificationPriorLbl}>prior</text>
                </svg>
              </div>
              <p className={styles.verificationDesc}>
                Wikipedia, blogs, videos. Higher AI scrutiny for unverifiable anonymous sources.
              </p>
              <div className={styles.verificationFormula}>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>URL</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '30%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>30%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>Title search</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '10%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>10%</span>
                </div>
                <div className={styles.verificationFormulaRow}>
                  <span className={styles.verificationFormulaLabel}>AI</span>
                  <div className={styles.verificationFormulaBar}>
                    <div className={styles.verificationFormulaFill} style={{ width: '60%' }} />
                  </div>
                  <span className={styles.verificationFormulaWeight}>60%</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.verificationCallout} data-reveal style={{ "--reveal-index": 2 } as React.CSSProperties}>
            <span className={styles.verificationCalloutIcon} aria-hidden="true">
              &#x1F50D;
            </span>
            <p className={styles.verificationCalloutText}>
              <strong>Claim-level verification</strong> &mdash; AI reads the exact sentence that
              cites each reference and checks whether the source actually supports the claim.
            </p>
          </div>

          <p className={styles.verificationFooter} data-reveal style={{ "--reveal-index": 3 } as React.CSSProperties}>
            Scoring logic is open source &mdash;{' '}
            <a
              href="https://github.com/SottoFM/reference-verification-standard"
              target="_blank"
              rel="noopener noreferrer"
            >
              view on GitHub
            </a>
            . Community improvements welcome.
          </p>
        </div>
      </section>

      {/* ====== POWERED BY ====== */}
      <section
        className={`${styles.section} ${styles.sectionAlt}`} data-reveal
        aria-label="Powered by"
      >
        <PoweredByProviders />
      </section>

      {/* ====== EARLY ACCESS PRICING ====== */}
      <section className={styles.creatorSection} aria-label="Early access">
        <div className={styles.creatorGlow} aria-hidden="true" />
        <div className={styles.inner}>
          <div className={styles.centered} data-reveal>
            <span className={styles.overlineLight}>Early access</span>
            <h2 className={styles.h2Light}>
              Free during
              <br />
              early access.
            </h2>
            <p className={styles.bodyLgLight}>
              Everything is free for early members — no limits, no card required.
              Generate podcasts with platform AI and voices, or bring your own API keys.
              We&apos;ll introduce plans later, and early members will be grandfathered in.
            </p>
          </div>
          <div className={`${styles.creatorStats} ${styles.creatorStatsCentered}`}>
            <div className={styles.creatorStat}>
              <span className={styles.creatorStatNum}>$0</span>
              <span className={styles.creatorStatLabel}>Early access</span>
            </div>
            <div className={styles.creatorStatDivider} aria-hidden="true" />
            <div className={styles.creatorStat}>
              <span className={styles.creatorStatNum}>BYOK</span>
              <span className={styles.creatorStatLabel}>Bring your own keys</span>
            </div>
          </div>
          <div className={styles.byokProviders} data-reveal>
            <span className={styles.byokProvidersLabel}>Supported BYOK providers</span>
            <div className={styles.byokProvidersList}>
              <span className={styles.byokProviderPill}>Anthropic</span>
              <span className={styles.byokProviderPill}>OpenAI</span>
              <span className={styles.byokProviderPill}>Google</span>
              <span className={styles.byokProviderPill}>ElevenLabs</span>
              <span className={styles.byokProviderPill}>Cartesia</span>
              <span className={styles.byokProviderPill}>Hume</span>
              <span className={styles.byokProviderPill}>Together AI</span>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FINAL CTA ====== */}
      <section className={styles.cta} aria-label="Get started">
        <div className={styles.ctaGlow} aria-hidden="true" />
        <div className={styles.ctaContent} data-reveal>
          <h2 className={styles.ctaTitle}>
            Start creating <em>today.</em>
          </h2>
          <p className={styles.ctaSub}>
            {BRAND.subline}
          </p>
          <AuthCTA source="cta" />
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.footerLogo}>{BRAND.name}</span>
            <p>{BRAND.tagline}</p>
          </div>
          <div className={styles.footerCols}>
            <div>
              <strong className={styles.footerHeading}>Product</strong>
              <a href="#features">Features</a>
              <Link href="/voices">Voices</Link>
              <Link href="/feed">Feed</Link>
            </div>
            <div>
              <strong className={styles.footerHeading}>Company</strong>
              <Link href="/feedback" className={styles.footerFeedback}>
                Share Feedback
              </Link>
              <Link href="/about">About</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/join">Join Us</Link>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          &copy; {new Date().getFullYear()} Sotto. All rights reserved.
        </div>
      </footer>
    </LandingShell>
    </WaitlistProvider>
  );
}
