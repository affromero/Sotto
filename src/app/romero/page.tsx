'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

const VOICES = [
  { name: 'Adam', accent: 'American', character: 'Warm narrator', gender: 'm' },
  { name: 'Rachel', accent: 'American', character: 'Calm & authoritative', gender: 'f' },
  { name: 'George', accent: 'British', character: 'Distinguished professor', gender: 'm' },
  { name: 'Freya', accent: 'British', character: 'Witty & sharp', gender: 'f' },
  { name: 'Sam', accent: 'American', character: 'Upbeat storyteller', gender: 'm' },
  { name: 'Charlotte', accent: 'British', character: 'Polished professional', gender: 'f' },
  { name: 'Charlie', accent: 'Australian', character: 'Casual & curious', gender: 'm' },
  { name: 'Grace', accent: 'Australian', character: 'Warm & approachable', gender: 'f' },
];

const CHECK = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8.5l3 3 7-7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, form, [role="button"]';
const MAX_RIPPLES = 3;

export default function LandingPage() {
  const [navSolid, setNavSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const activeRipples = useRef(0);

  const handlePageClick = useCallback((e: MouseEvent) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    if (activeRipples.current >= MAX_RIPPLES) return;

    const container = pageRef.current;
    if (!container) return;

    const ripple = document.createElement('div');
    ripple.className = styles.ripple;
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty('--ripple-x', `${e.pageX}px`);
    ripple.style.setProperty('--ripple-y', `${e.pageY}px`);

    activeRipples.current += 1;
    container.appendChild(ripple);

    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      ripple.remove();
      activeRipples.current -= 1;
    };

    ripple.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 2500);
  }, []);

  useEffect(() => {
    const onScroll = () => setNavSolid(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.vis);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll(`.${styles.rev}`).forEach((el) => observer.observe(el));

    const pageEl = pageRef.current;
    if (pageEl) {
      pageEl.addEventListener('click', handlePageClick);
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (pageEl) {
        pageEl.removeEventListener('click', handlePageClick);
      }
    };
  }, [handlePageClick]);

  return (
    <div ref={pageRef} className={styles.page}>
      {/* ====== NAV ====== */}
      <nav
        className={`${styles.nav} ${navSolid ? styles.navSolid : ''}`}
        role="navigation"
        aria-label="Main"
      >
        <div className={styles.navInner}>
          <Link href="/romero" className={styles.navLogo} aria-label="Sotto home">
            Sotto
          </Link>
          <div className={`${styles.navLinks} ${menuOpen ? styles.navLinksOpen : ''}`}>
            <a href="#features" onClick={() => setMenuOpen(false)}>
              Features
            </a>
            <a href="#voices" onClick={() => setMenuOpen(false)}>
              Voices
            </a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>
              Pricing
            </a>
          </div>
          <div className={styles.navRight}>
            <Link href="/feed" className={styles.navCta}>
              Explore Feed
            </Link>
            <Link href="/auth/login" className={styles.navSign}>
              Sign In
            </Link>
            <button
              type="button"
              className={`${styles.burger} ${menuOpen ? styles.burgerOpen : ''}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </nav>

      {/* ====== HERO ====== */}
      <section className={styles.hero} aria-label="Introduction">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            The Open Podcast Network
          </div>
          <h1 className={styles.heroTitle}>
            Create. Fork.
            <br />
            <em>Share.</em>
          </h1>
          <p className={styles.heroSub}>
            Generate AI podcasts, import your own, or fork someone else&apos;s. Ask questions
            mid-playback. Discover what others are learning on the social feed.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/feed" className={styles.btnPrimary}>
              Explore the Feed
            </Link>
            <Link href="/auth/login" className={styles.btnGhost}>
              Sign In
            </Link>
          </div>
        </div>
        <div className={styles.heroWave} aria-hidden="true">
          {Array.from({ length: 64 }, (_, i) => (
            <span key={i} className={styles.bar} style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
      </section>

      {/* ====== PILLARS ====== */}
      <section className={styles.section} id="features" aria-label="Key features">
        <div className={styles.inner}>
          <div className={styles.pillars}>
            <article className={`${styles.pillar} ${styles.rev}`}>
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
                Found a podcast you love? Fork it. Change the angle, go deeper on a subtopic,
                swap the voice. It&apos;s GitHub for podcasts.
              </p>
            </article>
            <article className={`${styles.pillar} ${styles.rev} ${styles.d1}`}>
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
                Upload human-recorded episodes, lectures, or NotebookLM exports. Sotto adds
                transcripts, social features, and interactive Q&amp;A on top.
              </p>
            </article>
            <article className={`${styles.pillar} ${styles.rev} ${styles.d2}`}>
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
                Pause mid-playback to ask a question. Get an answer in full context. Your Q&amp;A
                gets woven back into the episode permanently.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ====== DEMO ====== */}
      <section className={`${styles.section} ${styles.sectionAlt}`} aria-label="Product demo">
        <div className={styles.inner}>
          <div className={styles.split}>
            <div className={`${styles.splitText} ${styles.rev}`}>
              <span className={styles.overline}>See it in action</span>
              <h2 className={styles.h2}>From curiosity to podcast in under a minute</h2>
              <p className={styles.bodyLg}>
                Describe what you want to learn. Sotto chats with you to understand your background
                and interests, then crafts a podcast that feels like it was made by your favorite
                producers.
              </p>
            </div>
            <div className={`${styles.splitVisual} ${styles.rev} ${styles.d1}`}>
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

      {/* ====== INTERRUPT ====== */}
      <section className={styles.section} aria-label="Interactive feature">
        <div className={styles.inner}>
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <div className={`${styles.splitText} ${styles.rev}`}>
              <span className={styles.overline}>Interactive</span>
              <h2 className={styles.h2}>The podcast that pauses when you&apos;re curious</h2>
              <p className={styles.bodyLg}>
                Unlike anything you&apos;ve listened to before. Tap to interrupt, ask a follow-up,
                and get an answer drawn from the full context of what you&apos;ve been hearing. Then
                your Q&amp;A gets woven back into the conversation.
              </p>
            </div>
            <div className={`${styles.splitVisual} ${styles.rev} ${styles.d1}`}>
              <div className={styles.interruptMock}>
                <div className={styles.interruptPlaying}>
                  <div className={styles.interruptWave} aria-hidden="true">
                    {Array.from({ length: 32 }, (_, i) => (
                      <span
                        key={i}
                        className={styles.interruptBar}
                        style={{ '--j': i } as React.CSSProperties}
                      />
                    ))}
                  </div>
                  <div className={styles.interruptTranscript}>
                    <p>
                      <span className={styles.speakerHost}>Host:</span> &ldquo;...so the Cas9
                      protein acts like molecular scissors, cutting the DNA at a precise
                      location&mdash;&rdquo;
                    </p>
                  </div>
                </div>
                <div className={styles.interruptPause}>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="5" y="3" width="4" height="14" rx="1" />
                    <rect x="11" y="3" width="4" height="14" rx="1" />
                  </svg>
                  You paused to ask:
                </div>
                <div className={styles.interruptQuestion}>
                  &ldquo;Wait, what exactly is a guide RNA?&rdquo;
                </div>
                <div className={styles.interruptAnswer}>
                  <div className={styles.chatAvatar} aria-hidden="true">
                    S
                  </div>
                  <div>
                    <p className={styles.interruptAnswerLabel}>Sotto answered:</p>
                    <p>
                      &ldquo;Think of it as GPS coordinates for CRISPR. The guide RNA tells Cas9
                      exactly where on the genome to make its cut. Without it, the scissors have no
                      target.&rdquo;
                    </p>
                  </div>
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
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overline}>Premium Voices</span>
            <h2 className={styles.h2}>Every podcast sounds different. By design.</h2>
            <p className={styles.bodyLg}>
              Choose from 16 curated AI voices or clone your own. Every podcast pairs a unique host
              and expert for natural, engaging conversation.
            </p>
          </div>
          <div className={styles.voiceGrid}>
            {VOICES.map((v, i) => (
              <div
                key={v.name}
                className={`${styles.voiceCard} ${styles.rev}`}
                style={{ '--vi': i } as React.CSSProperties}
              >
                <div
                  className={`${styles.voiceAvatar} ${v.gender === 'f' ? styles.voiceAvatarF : ''}`}
                >
                  {v.name[0]}
                </div>
                <div className={styles.voiceInfo}>
                  <span className={styles.voiceName}>{v.name}</span>
                  <span className={styles.voiceChar}>{v.character}</span>
                </div>
                <span className={styles.voiceAccent}>{v.accent}</span>
              </div>
            ))}
          </div>
          <div className={`${styles.voicePairing} ${styles.rev}`}>
            <div className={styles.pairingExample}>
              <div className={`${styles.pairingRole} ${styles.pairingHost}`}>
                <span className={styles.pairingDot} />
                Host
              </div>
              <div className={styles.pairingLine} aria-hidden="true" />
              <div className={styles.pairingLabel}>contrasting voices</div>
              <div className={styles.pairingLine} aria-hidden="true" />
              <div className={`${styles.pairingRole} ${styles.pairingExpert}`}>
                <span className={styles.pairingDot} />
                Expert
              </div>
            </div>
            <p className={styles.pairingHint}>
              Sotto automatically pairs voices with different genders, accents, or tones for
              auditory contrast. Or pick your own combination.
            </p>
          </div>
        </div>
      </section>

      {/* ====== CREATOR ECONOMY ====== */}
      <section className={styles.creatorSection} aria-label="Creator economy">
        <div className={styles.creatorGlow} aria-hidden="true" />
        <div className={styles.inner}>
          <div className={styles.split}>
            <div className={`${styles.splitText} ${styles.rev}`}>
              <span className={styles.overlineLight}>Creator Economy</span>
              <h2 className={styles.h2Light}>
                Your voice is an asset.
                <br />
                Start earning from it.
              </h2>
              <p className={styles.bodyLgLight}>
                Clone your voice, list it on the Sotto marketplace, and earn every time someone uses
                it for their podcast. Set your own price. Approve every use. Keep 80% of revenue.
              </p>
              <div className={styles.creatorStats}>
                <div className={styles.creatorStat}>
                  <span className={styles.creatorStatNum}>80%</span>
                  <span className={styles.creatorStatLabel}>Creator revenue share</span>
                </div>
                <div className={styles.creatorStatDivider} aria-hidden="true" />
                <div className={styles.creatorStat}>
                  <span className={styles.creatorStatNum}>$1–10</span>
                  <span className={styles.creatorStatLabel}>You set the price per use</span>
                </div>
                <div className={styles.creatorStatDivider} aria-hidden="true" />
                <div className={styles.creatorStat}>
                  <span className={styles.creatorStatNum}>Subs</span>
                  <span className={styles.creatorStatLabel}>Monthly voice subscriptions</span>
                </div>
              </div>
            </div>
            <div className={`${styles.splitVisual} ${styles.rev} ${styles.d1}`}>
              <div className={styles.marketplaceMock}>
                <div className={styles.marketplaceHeader}>
                  <span className={styles.marketplaceTitle}>Voice Marketplace</span>
                  <span className={styles.marketplaceBrowse}>Browse all</span>
                </div>
                <div className={styles.marketplaceList}>
                  <div className={styles.marketplaceVoice}>
                    <div className={`${styles.marketplaceAvatar} ${styles.marketplaceAvatarAmber}`}>
                      S
                    </div>
                    <div className={styles.marketplaceInfo}>
                      <span className={styles.marketplaceName}>Sarah Mitchell</span>
                      <span className={styles.marketplaceMeta}>British · Warm · Storytelling</span>
                    </div>
                    <div className={styles.marketplaceRight}>
                      <span className={styles.marketplacePrice}>$3/use</span>
                      <span className={styles.marketplaceUses}>1.2k uses</span>
                    </div>
                  </div>
                  <div className={styles.marketplaceVoice}>
                    <div className={`${styles.marketplaceAvatar} ${styles.marketplaceAvatarNavy}`}>
                      J
                    </div>
                    <div className={styles.marketplaceInfo}>
                      <span className={styles.marketplaceName}>James Chen</span>
                      <span className={styles.marketplaceMeta}>
                        American · Deep · Authoritative
                      </span>
                    </div>
                    <div className={styles.marketplaceRight}>
                      <span className={styles.marketplacePrice}>$5/use</span>
                      <span className={styles.marketplaceUses}>847 uses</span>
                    </div>
                  </div>
                  <div className={styles.marketplaceVoice}>
                    <div className={`${styles.marketplaceAvatar} ${styles.marketplaceAvatarAmber}`}>
                      L
                    </div>
                    <div className={styles.marketplaceInfo}>
                      <span className={styles.marketplaceName}>Lena Rossi</span>
                      <span className={styles.marketplaceMeta}>Italian · Expressive · Warm</span>
                    </div>
                    <div className={styles.marketplaceRight}>
                      <span className={styles.marketplacePrice}>$4/use</span>
                      <span className={styles.marketplaceUses}>623 uses</span>
                    </div>
                  </div>
                </div>
                <div className={styles.marketplaceEarnings}>
                  <div className={styles.earningsHeader}>
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
                      <path d="M1 14l3.5-4 3 2.5 4-5.5 3.5 3" />
                    </svg>
                    Your Earnings
                  </div>
                  <div className={styles.earningsRow}>
                    <span>This month</span>
                    <span className={styles.earningsAmount}>$247.80</span>
                  </div>
                  <div className={styles.earningsRow}>
                    <span>Active subscribers</span>
                    <span className={styles.earningsAmount}>38</span>
                  </div>
                  <div className={styles.earningsBar}>
                    <div className={styles.earningsBarFill} style={{ width: '72%' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.creatorFlow}>
            <div className={`${styles.creatorFlowStep} ${styles.rev}`}>
              <div className={styles.creatorFlowIcon}>
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
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <h4>Clone your voice</h4>
              <p>
                Upload a 30s audio sample. Our AI creates a digital twin of your voice in minutes.
              </p>
            </div>
            <div className={styles.creatorFlowArrow} aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>
            <div className={`${styles.creatorFlowStep} ${styles.rev} ${styles.d1}`}>
              <div className={styles.creatorFlowIcon}>
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
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <h4>List on marketplace</h4>
              <p>
                Set your price. Add a description. Your voice appears in the Sotto voice library.
              </p>
            </div>
            <div className={styles.creatorFlowArrow} aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>
            <div className={`${styles.creatorFlowStep} ${styles.rev} ${styles.d2}`}>
              <div className={styles.creatorFlowIcon}>
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
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
              </div>
              <h4>Get paid</h4>
              <p>
                Approve usage requests. Earn per-use fees or monthly subscriptions. Payouts are
                automatic.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FORK & REMIX ====== */}
      <section className={styles.section} aria-label="Fork and remix">
        <div className={styles.inner}>
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <div className={`${styles.splitText} ${styles.rev}`}>
              <span className={styles.overline}>Fork &amp; Remix</span>
              <h2 className={styles.h2}>Build on what others started</h2>
              <p className={styles.bodyLg}>
                Found a podcast you love? Fork it. Take someone else&apos;s script as a starting
                point and make it yours — change the angle, update the focus, go deeper on a
                subtopic. It&apos;s GitHub for podcasts.
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
                    <circle cx="5" cy="3.5" r="2.5" />
                    <circle cx="5" cy="12.5" r="2.5" />
                    <circle cx="13" cy="8" r="2.5" />
                    <path d="M5 6v4M7.5 12.5h3a2.5 2.5 0 0 0 0-5h-3" />
                  </svg>
                  <span>Fork any public podcast</span>
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
                    <path d="M11 4H2v10h10V5" />
                    <path d="M14 1H5v3h9V1z" />
                    <path d="M5 8h4M5 11h6" />
                  </svg>
                  <span>Edit the script, swap voices, add your twist</span>
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
                    <path d="M8 1v6m0 0l-3-3m3 3l3-3" />
                    <path d="M1 11v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <span>Regenerate with your own voice</span>
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
                    <path d="M14.5 8A6.5 6.5 0 1 1 8 1.5" />
                    <path d="M8 8l4-4" />
                    <circle cx="13" cy="3" r="2" />
                  </svg>
                  <span>Credit always links back to the original</span>
                </div>
              </div>
            </div>
            <div className={`${styles.splitVisual} ${styles.rev} ${styles.d1}`}>
              <div className={styles.forkMock}>
                <div className={styles.forkOriginal}>
                  <div className={styles.forkCardLabel}>Original</div>
                  <div className={styles.forkCardContent}>
                    <h4>How CRISPR Is Changing Medicine</h4>
                    <p className={styles.forkCardMeta}>by Dr. Sarah K. · 8 min · 342 listens</p>
                    <div className={styles.forkCardTags}>
                      <span>Biology</span>
                      <span>Gene Editing</span>
                      <span>Ethics</span>
                    </div>
                  </div>
                </div>
                <div className={styles.forkArrowDown} aria-hidden="true">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="5" cy="3" r="2" />
                    <circle cx="5" cy="17" r="2" />
                    <circle cx="15" cy="10" r="2" />
                    <path d="M5 5v10M7 17h6a2 2 0 0 0 0-4H7" />
                  </svg>
                  <span>Fork</span>
                </div>
                <div className={styles.forkRemixed}>
                  <div className={`${styles.forkCardLabel} ${styles.forkCardLabelNew}`}>
                    Your remix
                  </div>
                  <div className={styles.forkCardContent}>
                    <h4>CRISPR for Cancer: The Ethical Debate</h4>
                    <p className={styles.forkCardMeta}>
                      Narrowed focus · Your voice · Updated sources
                    </p>
                    <div className={styles.forkCardEdits}>
                      <span className={styles.forkEditBadge}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M8.5 1.5l2 2L4 10H2V8z" />
                        </svg>
                        Script edited
                      </span>
                      <span className={styles.forkEditBadge}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M6 1a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
                          <path d="M10 5.5v1a4 4 0 0 1-8 0v-1" />
                        </svg>
                        Voice changed
                      </span>
                      <span className={styles.forkEditBadge}>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M1 6h10M6 1v10" />
                        </svg>
                        3 sources added
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== USE CASES ====== */}
      <section className={styles.section} aria-label="Use cases">
        <div className={styles.inner}>
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overline}>Built for the curious</span>
            <h2 className={styles.h2}>Turn any topic into a podcast worth sharing</h2>
          </div>
          <div className={styles.useCases}>
            <article className={`${styles.useCase} ${styles.rev}`}>
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
            <article className={`${styles.useCase} ${styles.rev} ${styles.d1}`}>
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
            <article className={`${styles.useCase} ${styles.rev} ${styles.d2}`}>
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
            <article className={`${styles.useCase} ${styles.rev} ${styles.d3}`}>
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
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overline}>How it works</span>
            <h2 className={styles.h2}>Three steps. One incredible podcast.</h2>
          </div>
          <div className={styles.steps}>
            <div className={`${styles.step} ${styles.rev}`}>
              <div className={styles.stepNum}>1</div>
              <div className={styles.stepContent}>
                <h3>Create or import</h3>
                <p>
                  Chat with Sotto to generate a two-voice podcast from any topic. Or upload an
                  existing episode — human-recorded, AI-made, anything.
                </p>
              </div>
            </div>
            <div className={styles.stepLine} aria-hidden="true" />
            <div className={`${styles.step} ${styles.rev} ${styles.d1}`}>
              <div className={styles.stepNum}>2</div>
              <div className={styles.stepContent}>
                <h3>Listen, ask, fork</h3>
                <p>
                  Follow along with an interactive transcript. Pause to ask questions anytime. Fork
                  any public podcast to remix it with your own angle.
                </p>
              </div>
            </div>
            <div className={styles.stepLine} aria-hidden="true" />
            <div className={`${styles.step} ${styles.rev} ${styles.d2}`}>
              <div className={styles.stepNum}>3</div>
              <div className={styles.stepContent}>
                <h3>Share on the feed</h3>
                <p>
                  Your podcasts join a social feed. Discover what others are learning. Follow
                  creators, explore fork lineages, and build on each other&apos;s work.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== PRICING ====== */}
      <section className={styles.section} aria-label="Pricing" id="pricing">
        <div className={styles.inner}>
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overline}>Pricing</span>
            <h2 className={styles.h2}>Simple, honest pricing</h2>
            <p className={styles.bodyLg}>Start free. Upgrade when you need more.</p>
          </div>
          <div className={styles.tiers}>
            {/* FREE */}
            <div className={`${styles.tier} ${styles.rev}`}>
              <div className={styles.tierHead}>
                <h3>Free</h3>
                <div className={styles.tierPrice}>
                  <span className={styles.tierAmount}>$0</span>
                </div>
                <p className={styles.tierDesc}>Perfect for trying Sotto</p>
              </div>
              <ul className={styles.tierFeatures}>
                <li>{CHECK} 3 credits per month</li>
                <li>{CHECK} Up to 5 minutes per podcast</li>
                <li>{CHECK} Standard AI voices</li>
                <li>{CHECK} Public podcasts only</li>
                <li>{CHECK} Fork, listen, share</li>
              </ul>
              <Link href="/feed" className={styles.tierBtn}>
                Explore Feed
              </Link>
            </div>
            {/* STARTER */}
            <div className={`${styles.tier} ${styles.tierFeatured} ${styles.rev} ${styles.d1}`}>
              <div className={styles.tierBadge}>Most Popular</div>
              <div className={styles.tierHead}>
                <h3>Starter</h3>
                <div className={styles.tierPrice}>
                  <span className={styles.tierAmount}>$14</span>
                  <span className={styles.tierPeriod}>/mo</span>
                </div>
                <p className={styles.tierDesc}>For power learners</p>
              </div>
              <ul className={styles.tierFeatures}>
                <li>{CHECK} 5 credits per month (+1 rollover)</li>
                <li>{CHECK} Up to 10 minutes per podcast</li>
                <li>{CHECK} Clone 1 voice</li>
                <li>{CHECK} Private &amp; unlisted podcasts</li>
                <li>{CHECK} MP3 download + PDF transcript</li>
                <li>{CHECK} Credit packs available</li>
              </ul>
              <Link href="/feed" className={styles.tierBtnPrimary}>
                Explore Feed
              </Link>
            </div>
            {/* PRO */}
            <div className={`${styles.tier} ${styles.rev} ${styles.d2}`}>
              <div className={styles.tierHead}>
                <h3>Pro</h3>
                <div className={styles.tierPrice}>
                  <span className={styles.tierAmount}>$34</span>
                  <span className={styles.tierPeriod}>/mo</span>
                </div>
                <p className={styles.tierDesc}>For serious creators</p>
              </div>
              <ul className={styles.tierFeatures}>
                <li>{CHECK} 10 credits per month (+3 rollover)</li>
                <li>{CHECK} Clone up to 3 voices</li>
                <li>{CHECK} Premium sound effects</li>
                <li>{CHECK} Voice library access</li>
                <li>{CHECK} Everything in Starter</li>
              </ul>
              <Link href="/feed" className={styles.tierBtn}>
                Explore Feed
              </Link>
            </div>
          </div>
          <p className={styles.tierFootnote}>
            All plans include unlimited listening, forking, and interactions. 1 credit = 1 podcast.
          </p>
        </div>
      </section>

      {/* ====== FINAL CTA ====== */}
      <section className={styles.cta} aria-label="Get started">
        <div className={styles.ctaGlow} aria-hidden="true" />
        <div className={`${styles.ctaContent} ${styles.rev}`}>
          <h2 className={styles.ctaTitle}>
            Create. Fork. <em>Share.</em>
          </h2>
          <p className={styles.ctaSub}>
            Generate AI podcasts, import your own, or fork someone else&apos;s. Join the open podcast
            network.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/feed" className={styles.btnPrimary}>
              Explore the Feed
            </Link>
            <Link href="/auth/login" className={styles.btnGhost}>
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.footerLogo}>Sotto</span>
            <p>The open podcast network.</p>
          </div>
          <div className={styles.footerCols}>
            <div>
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#voices">Voices</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="/feedback" className={styles.footerFeedback}>
                Share Feedback
              </a>
              <a href="#">About</a>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          &copy; {new Date().getFullYear()} Sotto. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
