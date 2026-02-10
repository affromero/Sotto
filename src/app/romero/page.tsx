'use client';

import { useEffect, useState, useCallback, useRef, useMemo, FormEvent } from 'react';
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

const TW_ICONS = {
  reply: (
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
      <path d="M1 11c0-2.2 1.8-4 4-4h6" />
      <path d="M8 3l4 4-4 4" />
    </svg>
  ),
  repost: (
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
      <path d="M1.5 5.5h10l-2.5-3" />
      <path d="M14.5 10.5h-10l2.5 3" />
    </svg>
  ),
  heart: (
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
      <path d="M8 14s-5.5-3.5-5.5-7.5C2.5 4 4 2.5 5.5 2.5 6.8 2.5 7.7 3.3 8 4c.3-.7 1.2-1.5 2.5-1.5C12 2.5 13.5 4 13.5 6.5 13.5 10.5 8 14 8 14z" />
    </svg>
  ),
  bookmark: (
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
      <path d="M3 2.5h10v12l-5-3.5-5 3.5v-12z" />
    </svg>
  ),
  share: (
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
      <path d="M2 11l6-7 6 7" />
      <path d="M8 4v10" />
    </svg>
  ),
  verified: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="#1d9bf0" aria-hidden="true">
      <path d="M8 0l1.8 2.9L13 2l-.1 3.3L16 7l-2.5 2.1.7 3.2-3.1.5L10 15.5 8 13l-2 2.5-1.1-2.7-3.1-.5.7-3.2L0 7l3.1-1.7L3 2l3.2.9L8 0z" />
      <path
        d="M5.5 8l1.5 1.5 3.5-3.5"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

type WaitlistStatus = 'idle' | 'submitting' | 'success' | 'error';

function WaitlistForm({
  source,
  variant = 'dark',
}: {
  source: string;
  variant?: 'dark' | 'light';
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<WaitlistStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      });

      if (!res.ok) {
        const data = await res.json();
        const msg = data?.error?.fieldErrors?.email?.[0] || 'Please enter a valid email.';
        setErrorMsg(msg);
        setStatus('error');
        return;
      }

      setStatus('success');
      setEmail('');
    } catch {
      setErrorMsg('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div
        className={`${styles.waitlistSuccess} ${variant === 'light' ? styles.waitlistSuccessLight : ''}`}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.15" />
          <path
            d="M6 10.5l2.5 2.5 5.5-5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        You&apos;re on the list! We&apos;ll let you know when Sotto launches.
      </div>
    );
  }

  return (
    <form
      className={`${styles.waitlistForm} ${variant === 'light' ? styles.waitlistFormLight : ''}`}
      onSubmit={handleSubmit}
    >
      <input
        type="email"
        className={`${styles.waitlistInput} ${variant === 'light' ? styles.waitlistInputLight : ''}`}
        placeholder="you@email.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (status === 'error') setStatus('idle');
        }}
        required
        aria-label="Email address"
      />
      <button type="submit" className={styles.waitlistBtn} disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Joining...' : 'Join the Waitlist'}
      </button>
      {status === 'error' && <p className={styles.waitlistError}>{errorMsg}</p>}
    </form>
  );
}

const TOPICS = [
  'Quantum Computing',
  'Stoic Philosophy',
  'Jazz History',
  'Game Theory',
  'The Silk Road',
  'Neural Networks',
  'Behavioral Economics',
  'The Art of Fermentation',
];

function TopicSuggestions() {
  const timings = useMemo(
    () =>
      TOPICS.map((_, i) => {
        const enterDelay = 0.4 + i * 0.08;
        const enterEnd = enterDelay + 0.5;
        return {
          breathDuration: `${3.2 + ((i * 7 + 3) % 25) / 10}s`,
          breathDelay: `${enterEnd + ((i * 13 + 5) % 35) / 10}s`,
          enterDelay: `${enterDelay}s`,
        };
      }),
    []
  );

  return (
    <div className={styles.topicSuggestions}>
      {TOPICS.map((topic, i) => (
        <a
          key={topic}
          href="/create"
          className={styles.topicPill}
          style={
            {
              '--breath-duration': timings[i].breathDuration,
              '--breath-delay': timings[i].breathDelay,
              '--enter-delay': timings[i].enterDelay,
            } as React.CSSProperties
          }
        >
          {topic}
        </a>
      ))}
    </div>
  );
}

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
          <Link href="/" className={styles.navLogo} aria-label="Sotto home">
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
            <a href="/auth/signup" className={styles.navCta}>
              Get Started
            </a>
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
      <section className={styles.hero} id="waitlist" aria-label="Introduction">
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            Now in Alpha
          </div>
          <h1 className={styles.heroTitle}>
            Podcasts That
            <br />
            Listen <em>Back</em>
          </h1>
          <p className={styles.heroSub}>
            Generate AI podcasts from any topic. Interrupt mid-playback to ask questions. Share
            knowledge with the world.
          </p>
          <TopicSuggestions />
          <div className={styles.heroCtas}>
            <a href="/auth/signup" className={styles.btnPrimary}>
              Get Started Free
            </a>
          </div>
          <p className={styles.heroCtaNote}>No credit card required</p>
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
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <h3>AI-Powered Discovery</h3>
              <p>
                Chat naturally about what you want to learn. Sotto asks the right questions, then
                generates a two-voice podcast tailored to your level.
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
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3>Interactive Playback</h3>
              <p>
                Pause anytime to ask questions. Get answers in full context. Your curiosity drives
                the conversation — the podcast actually listens back.
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
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              </div>
              <h3>Voices That Feel Real</h3>
              <p>
                16 curated AI voices or clone your own. Every podcast pairs a distinct host and
                expert — always in contrast, always unique.
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

      {/* ====== TWITTER ====== */}
      <section
        className={`${styles.section} ${styles.sectionAlt}`}
        aria-label="Twitter integration"
      >
        <div className={styles.inner}>
          <div className={styles.split}>
            <div className={`${styles.splitText} ${styles.rev}`}>
              <span className={styles.overline}>Twitter Integration</span>
              <h2 className={styles.h2}>Tweet it. Hear it. Share it.</h2>
              <p className={styles.bodyLg}>
                Tag <strong>@sottofm</strong> in any tweet or thread and we&apos;ll turn it into a
                two-voice podcast. Claude parses your request, generates the script, and replies
                with a link — all without leaving X.
              </p>
              <div className={styles.twFeatures}>
                <div className={styles.twFeature}>
                  {CHECK}
                  <span>Works from any public tweet or thread</span>
                </div>
                <div className={styles.twFeature}>
                  {CHECK}
                  <span>Claude parses your topic, depth, and tone</span>
                </div>
                <div className={styles.twFeature}>
                  {CHECK}
                  <span>Two-voice podcast ready in ~2 minutes</span>
                </div>
                <div className={styles.twFeature}>
                  {CHECK}
                  <span>Reply lands right in your thread</span>
                </div>
              </div>
            </div>
            <div className={`${styles.splitVisual} ${styles.rev} ${styles.d1}`}>
              <p className={styles.srOnly}>
                A mockup of three tweets showing the Sotto Twitter flow: someone asks about quantum
                computing, a friend tags @sottofm, and Sotto replies with a ready podcast link.
              </p>
              <div className={styles.twMock} aria-hidden="true">
                {/* Tweet 1 — Original poster */}
                <div className={styles.twPost}>
                  <div className={styles.twPostLeft}>
                    <div className={styles.twAvatar}>M</div>
                    <div className={styles.twThread} />
                  </div>
                  <div className={styles.twPostBody}>
                    <div className={styles.twPostHeader}>
                      <span className={styles.twName}>Maya</span>
                      <span>@mayalearns · 2h</span>
                    </div>
                    <p className={styles.twText}>
                      I keep hearing about quantum computing but every explanation either assumes I
                      have a physics PhD or is so dumbed down it&apos;s useless. Where&apos;s the
                      middle ground?
                    </p>
                    <div className={styles.twActions}>
                      {TW_ICONS.reply}
                      <span>4</span>
                      {TW_ICONS.repost}
                      <span>2</span>
                      {TW_ICONS.heart}
                      <span>18</span>
                      {TW_ICONS.bookmark}
                      {TW_ICONS.share}
                    </div>
                  </div>
                </div>

                {/* Tweet 2 — Friend tags sotto */}
                <div className={styles.twPost}>
                  <div className={styles.twPostLeft}>
                    <div className={styles.twAvatarAlt}>J</div>
                    <div className={styles.twThread} />
                  </div>
                  <div className={styles.twPostBody}>
                    <div className={styles.twPostHeader}>
                      <span className={styles.twName}>Jake</span>
                      <span>@jakedev_ · 1h</span>
                    </div>
                    <p className={styles.twText}>
                      <span className={styles.twMention}>@sottofm</span> make her a podcast about
                      this! Beginner-friendly, focus on the practical applications
                    </p>
                    <div className={styles.twActions}>
                      {TW_ICONS.reply}
                      <span>1</span>
                      {TW_ICONS.repost}
                      {TW_ICONS.heart}
                      <span>7</span>
                      {TW_ICONS.bookmark}
                      {TW_ICONS.share}
                    </div>
                  </div>
                </div>

                {/* Tweet 3 — Sotto replies */}
                <div className={`${styles.twPost} ${styles.twPostSotto}`}>
                  <div className={styles.twPostLeft}>
                    <div className={styles.twAvatarSotto}>S</div>
                  </div>
                  <div className={styles.twPostBody}>
                    <div className={styles.twPostHeader}>
                      <span className={styles.twName}>Sotto</span>
                      {TW_ICONS.verified}
                      <span>@sottofm · 58m</span>
                    </div>
                    <p className={styles.twText}>
                      Your podcast is ready! &ldquo;Quantum Computing Demystified&rdquo; (8 min)
                    </p>
                    <div className={styles.twCard}>
                      <div className={styles.twCardVisual}>
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#fff"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                          <path d="M21 19a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h2v4zM3 19a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1H3v4z" />
                        </svg>
                      </div>
                      <div className={styles.twCardInfo}>
                        <span className={styles.twCardDomain}>sotto.fm</span>
                        <span>Quantum Computing Demystified</span>
                        <span>An 8-minute beginner-friendly explainer on quantum computing</span>
                      </div>
                    </div>
                    <div className={styles.twActions}>
                      {TW_ICONS.reply}
                      <span>3</span>
                      {TW_ICONS.repost}
                      <span>12</span>
                      <span className={styles.twHeartActive}>{TW_ICONS.heart}</span>
                      <span>42</span>
                      {TW_ICONS.bookmark}
                      {TW_ICONS.share}
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
                <h3>Describe what you want to learn</h3>
                <p>
                  Chat naturally with Sotto. Tell us the topic, your background, and what angle
                  interests you most. Our AI handles the rest.
                </p>
              </div>
            </div>
            <div className={styles.stepLine} aria-hidden="true" />
            <div className={`${styles.step} ${styles.rev} ${styles.d1}`}>
              <div className={styles.stepNum}>2</div>
              <div className={styles.stepContent}>
                <h3>Listen and interact</h3>
                <p>
                  A two-voice podcast is generated in under a minute. Listen with an interactive
                  transcript. Pause to ask questions anytime — Sotto answers in context.
                </p>
              </div>
            </div>
            <div className={styles.stepLine} aria-hidden="true" />
            <div className={`${styles.step} ${styles.rev} ${styles.d2}`}>
              <div className={styles.stepNum}>3</div>
              <div className={styles.stepContent}>
                <h3>Share with the world</h3>
                <p>
                  Your podcasts join a public feed. Discover what others are learning. Fork, remix,
                  and follow your favorite creators.
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
                <li>{CHECK} 1 credit per month</li>
                <li>{CHECK} Up to 5 minutes each</li>
                <li>{CHECK} Premium ElevenLabs voices</li>
                <li>{CHECK} Public podcasts</li>
                <li>{CHECK} 2 interactions per podcast</li>
              </ul>
              <a href="/auth/signup" className={styles.tierBtn}>
                Sign Up Free
              </a>
            </div>
            {/* STARTER */}
            <div className={`${styles.tier} ${styles.rev} ${styles.d1}`}>
              <div className={styles.tierHead}>
                <h3>Starter</h3>
                <div className={styles.tierPrice}>
                  <span className={styles.tierAmount}>$14</span>
                  <span className={styles.tierPeriod}>/mo</span>
                </div>
                <p className={styles.tierDesc}>For curious learners</p>
              </div>
              <ul className={styles.tierFeatures}>
                <li>{CHECK} 3 credits per month (+1 rollover)</li>
                <li>{CHECK} Up to 10 minutes each</li>
                <li>{CHECK} 1 voice clone</li>
                <li>{CHECK} 5 interactions per podcast</li>
                <li>{CHECK} MP3 download</li>
              </ul>
              <a href="/auth/signup" className={styles.tierBtn}>
                Get Started
              </a>
            </div>
            {/* PRO */}
            <div className={`${styles.tier} ${styles.tierFeatured} ${styles.rev} ${styles.d2}`}>
              <div className={styles.tierBadge}>Most Popular</div>
              <div className={styles.tierHead}>
                <h3>Pro</h3>
                <div className={styles.tierPrice}>
                  <span className={styles.tierAmount}>$34</span>
                  <span className={styles.tierPeriod}>/mo</span>
                </div>
                <p className={styles.tierDesc}>For power learners</p>
              </div>
              <ul className={styles.tierFeatures}>
                <li>{CHECK} 10 credits per month (+3 rollover)</li>
                <li>{CHECK} Up to 10 minutes each</li>
                <li>{CHECK} 3 voice clones</li>
                <li>{CHECK} Unlimited interactions</li>
                <li>{CHECK} Private podcasts + analytics</li>
                <li>{CHECK} Everything in Starter</li>
              </ul>
              <a href="/auth/signup" className={styles.tierBtnPrimary}>
                Get Started
              </a>
            </div>
            {/* STUDIO */}
            <div className={`${styles.tier} ${styles.rev} ${styles.d3}`}>
              <div className={styles.tierHead}>
                <h3>Studio</h3>
                <div className={styles.tierPrice}>
                  <span className={styles.tierAmount}>$69</span>
                  <span className={styles.tierPeriod}>/mo</span>
                </div>
                <p className={styles.tierDesc}>For serious creators</p>
              </div>
              <ul className={styles.tierFeatures}>
                <li>{CHECK} 20 credits per month (+8 rollover)</li>
                <li>{CHECK} Up to 10 minutes each</li>
                <li>{CHECK} 10 voice clones</li>
                <li>{CHECK} Premium sound effects</li>
                <li>{CHECK} Analytics + marketplace</li>
                <li>{CHECK} Everything in Pro</li>
              </ul>
              <a href="/auth/signup" className={styles.tierBtn}>
                Get Started
              </a>
            </div>
          </div>
          <p className={styles.tierFootnote}>
            All plans include unlimited listening. Pricing shown is for launch day.
          </p>
        </div>
      </section>

      {/* ====== FINAL CTA ====== */}
      <section className={styles.cta} aria-label="Get started">
        <div className={styles.ctaGlow} aria-hidden="true" />
        <div className={`${styles.ctaContent} ${styles.rev}`}>
          <h2 className={styles.ctaTitle}>Ready to start learning?</h2>
          <p className={styles.ctaSub}>
            Create your first AI podcast in under a minute. Free, no credit card required.
          </p>
          <a href="/auth/signup" className={styles.ctaBtn}>
            Get Started Free
          </a>
          <div className={styles.ctaDivider}>
            <span>or get notified at launch</span>
          </div>
          <WaitlistForm source="cta" variant="dark" />
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.footerLogo}>Sotto</span>
            <p>Podcasts that listen back.</p>
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
