'use client';

import { useEffect, useState, useCallback, useRef, FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { PoweredByProviders } from '@/components/landing/PoweredByProviders';
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

const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, form, [role="button"]';
const MAX_RIPPLES = 3;

export default function LandingPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [navSolid, setNavSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistTwitter, setWaitlistTwitter] = useState('');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [waitlistError, setWaitlistError] = useState('');
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

  async function handleWaitlistSubmit(e: FormEvent, source: string) {
    e.preventDefault();
    setWaitlistError('');
    setWaitlistLoading(true);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: waitlistEmail,
          twitterHandle: waitlistTwitter || undefined,
          source,
        }),
      });
      if (res.ok) {
        setWaitlistSubmitted(true);
      } else {
        setWaitlistError('Something went wrong. Please try again.');
      }
    } catch {
      setWaitlistError('Something went wrong. Please try again.');
    } finally {
      setWaitlistLoading(false);
    }
  }

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
            <Link href="/voices" onClick={() => setMenuOpen(false)}>
              Voices
            </Link>
          </div>
          <div className={styles.navRight}>
            <Link href="/feed" className={styles.navCta}>
              Explore Feed
            </Link>
            {!authLoading && (
              isAuthenticated ? (
                <Link href="/dashboard" className={styles.navSign}>
                  Dashboard
                </Link>
              ) : (
                <Link href="/auth/login" className={styles.navSign}>
                  Sign In
                </Link>
              )
            )}
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
          {isAuthenticated ? (
            <div className={styles.heroCtas}>
              <Link href="/feed" className={styles.btnPrimary}>
                Explore the Feed
              </Link>
              <Link href="/dashboard" className={styles.btnGhost}>
                Dashboard
              </Link>
            </div>
          ) : waitlistSubmitted ? (
            <div className={styles.waitlistSuccess}>
              You&apos;re on the list! We&apos;ll email you when your spot is ready.
            </div>
          ) : (
            <div className={styles.waitlistFormWrap}>
              <form className={styles.waitlistForm} onSubmit={(e) => handleWaitlistSubmit(e, 'hero')}>
                <input
                  className={styles.waitlistInput}
                  type="email"
                  placeholder="your@email.com"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  required
                  aria-label="Email address"
                />
                <input
                  className={styles.waitlistInput}
                  type="text"
                  placeholder="@twitter (optional)"
                  value={waitlistTwitter}
                  onChange={(e) => setWaitlistTwitter(e.target.value)}
                  aria-label="Twitter handle"
                />
                <button className={styles.waitlistSubmit} type="submit" disabled={waitlistLoading}>
                  {waitlistLoading ? 'Joining...' : 'Join the Waitlist'}
                </button>
              </form>
              {waitlistError && <p className={styles.waitlistError}>{waitlistError}</p>}
              <div className={styles.waitlistLinks}>
                <Link href="/feed" className={styles.waitlistLink}>Explore the Feed</Link>
                <Link href="/auth/login" className={styles.waitlistLink}>Sign In</Link>
              </div>
            </div>
          )}
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
                Send straight from NotebookLM with our Chrome extension — one click, no download.
                Or import from Spotify, Apple Podcasts, YouTube, or any audio file. Sotto adds
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
          <div className={`${styles.importPlatforms} ${styles.rev}`}>
            <span className={styles.importPlatformsLabel}>Import from</span>
            <div className={styles.importPlatformsList}>
              <span className={`${styles.importPlatformPill} ${styles.importPlatformPillHighlight}`}>
                NotebookLM
                <span className={styles.importPlatformBadge}>Chrome Extension</span>
              </span>
              <span className={styles.importPlatformPill}>Spotify</span>
              <span className={styles.importPlatformPill}>Apple Podcasts</span>
              <span className={styles.importPlatformPill}>YouTube</span>
              <span
                className={`${styles.importPlatformPill} ${styles.importPlatformPillMuted}`}
              >
                Any audio file
              </span>
            </div>
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
            <span className={styles.overline}>Voices</span>
            <h2 className={styles.h2}>Every podcast sounds different. By design.</h2>
            <p className={styles.bodyLg}>
              Choose from dozens of AI voices across providers or clone your own. Every podcast pairs
              a unique host and expert for natural, engaging conversation.
            </p>
          </div>
          <div className={styles.voiceGrid}>
            {VOICE_TRAITS.map((v, i) => (
              <div
                key={v.trait}
                className={`${styles.voiceCard} ${styles.rev}`}
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

      {/* ====== VOICE SHARING ====== */}
      <section className={styles.section} aria-label="Voice cloning and sharing">
        <div className={styles.inner}>
          <div className={`${styles.split} ${styles.splitReverse}`}>
            <div className={`${styles.splitText} ${styles.rev}`}>
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
            <div className={`${styles.splitVisual} ${styles.rev} ${styles.d1}`}>
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

      {/* ====== VOICE PROTECTION ====== */}
      <section className={styles.section} aria-label="Voice protection">
        <div className={styles.inner}>
          <div className={styles.centered}>
            <span className={styles.overline}>Voice Protection</span>
            <h2 className={styles.h2}>Your voice is yours. We make sure it stays that way.</h2>
            <p className={styles.bodyLg}>
              Every voice on Sotto goes through verification. No exceptions.
            </p>
          </div>
          <div className={styles.pillars}>
            <div className={styles.pillar}>
              <div className={styles.pIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h3>Verified Ownership</h3>
              <p>
                Every voice clone requires a live verification challenge. You record a phrase,
                we match it to your upload. Only you can put your voice on Sotto.
              </p>
            </div>
            <div className={styles.pillar}>
              <div className={styles.pIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2a10 10 0 1 0 10 10" />
                  <path d="M12 12l7-7" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>
              <h3>Impersonation Detection</h3>
              <p>
                Every upload is compared against our voiceprint database. If someone tries
                to clone a verified voice, we auto-block it and notify the owner instantly.
              </p>
            </div>
            <div className={styles.pillar}>
              <div className={`${styles.pIcon} ${styles.pIconNavy}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3>Creator Protection</h3>
              <p>
                Verified creators get a badge, priority in the marketplace, and full control
                over who uses their voice. Approve, deny, or monetize — on your terms.
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

      {/* ====== BOT INTEGRATIONS ====== */}
      <section className={styles.botSection} aria-label="Bot integrations">
        <div className={styles.botGlow} aria-hidden="true" />
        <div className={styles.inner}>
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overlineLight}>Generate from anywhere</span>
            <h2 className={styles.h2Light}>Tweet it. Message it. Done.</h2>
            <p className={styles.bodyLgLight}>
              Tag <strong>@sottofm</strong> on X or message <strong>@SottoFMBot</strong> on
              Telegram to save a topic or URL as a podcast idea — then open Sotto to generate.
            </p>
          </div>

          <div className={`${styles.botGrid} ${styles.rev} ${styles.d1}`}>
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
                  Save any topic or URL on the go
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
                  Chat with Sotto to generate a multi-voice podcast from any topic. Or import from
                  NotebookLM with our Chrome extension, Spotify, Apple Podcasts, YouTube — any
                  audio file works.
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

      {/* ====== OPEN VERIFICATION STANDARD ====== */}
      <section className={styles.section} aria-label="Open verification standard">
        <div className={styles.inner}>
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overline}>Open Verification Standard</span>
            <h2 className={styles.h2}>Domain-aware. Claim-level. Open source.</h2>
            <p className={styles.bodyLg}>
              Every reference is scored by its domain &mdash; because news articles don&apos;t need
              DOIs, and Wikipedia isn&apos;t held to the same bar as Nature.
            </p>
          </div>

          <div className={`${styles.verificationGrid} ${styles.rev} ${styles.d1}`}>
            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#1E3A5F',
                  '--verification-bg': 'rgba(30, 58, 95, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHeader}>
                <span className={styles.verificationDomain}>Academic</span>
                <span className={styles.verificationThreshold}>&ge; 0.70</span>
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

            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#D97706',
                  '--verification-bg': 'rgba(217, 119, 6, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHeader}>
                <span className={styles.verificationDomain}>News</span>
                <span className={styles.verificationThreshold}>&ge; 0.50</span>
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

            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#16A34A',
                  '--verification-bg': 'rgba(22, 163, 74, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHeader}>
                <span className={styles.verificationDomain}>Government</span>
                <span className={styles.verificationThreshold}>&ge; 0.55</span>
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

            <div
              className={styles.verificationCard}
              style={
                {
                  '--verification-color': '#6B7280',
                  '--verification-bg': 'rgba(107, 114, 128, 0.08)',
                } as React.CSSProperties
              }
            >
              <div className={styles.verificationCardHeader}>
                <span className={styles.verificationDomain}>General</span>
                <span className={styles.verificationThreshold}>&ge; 0.55</span>
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

          <div className={`${styles.verificationCallout} ${styles.rev} ${styles.d2}`}>
            <span className={styles.verificationCalloutIcon} aria-hidden="true">
              &#x1F50D;
            </span>
            <p className={styles.verificationCalloutText}>
              <strong>Claim-level verification</strong> &mdash; AI reads the exact sentence that
              cites each reference and checks whether the source actually supports the claim.
            </p>
          </div>

          <p className={`${styles.verificationFooter} ${styles.rev} ${styles.d3}`}>
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

      {/* ====== PRICING — FREE FOREVER + PRO + BYOK ====== */}
      <section className={styles.creatorSection} aria-label="Pricing">
        <div className={styles.creatorGlow} aria-hidden="true" />
        <div className={styles.inner}>
          <div className={`${styles.centered} ${styles.rev}`}>
            <span className={styles.overlineLight}>Simple, honest pricing</span>
            <h2 className={styles.h2Light}>
              1 podcast every day,
              <br />
              free forever.
            </h2>
            <p className={styles.bodyLgLight}>
              Start free — platform AI and voices included, no card needed. Upgrade to Pro for
              unlimited generation, better AI, voice tracks, and creator analytics. Or bring your
              own API keys for unlimited generation at cost price.
            </p>
            <div className={styles.landingProCta}>
              <a href="/pricing" className={styles.landingProCtaPrimary}>
                See all plans
              </a>
              <a href="/auth/signup" className={styles.landingProCtaSecondary}>
                Start free
              </a>
            </div>
          </div>
          <div className={`${styles.creatorStats} ${styles.creatorStatsCentered}`}>
            <div className={styles.creatorStat}>
              <span className={styles.creatorStatNum}>$0</span>
              <span className={styles.creatorStatLabel}>Free tier, forever</span>
            </div>
            <div className={styles.creatorStatDivider} aria-hidden="true" />
            <div className={styles.creatorStat}>
              <span className={styles.creatorStatNum}>$12</span>
              <span className={styles.creatorStatLabel}>Pro / month</span>
            </div>
            <div className={styles.creatorStatDivider} aria-hidden="true" />
            <div className={styles.creatorStat}>
              <span className={styles.creatorStatNum}>BYOK</span>
              <span className={styles.creatorStatLabel}>Unlimited at cost</span>
            </div>
          </div>
          <div className={`${styles.byokProviders} ${styles.rev}`}>
            <span className={styles.byokProvidersLabel}>Supported BYOK providers</span>
            <div className={styles.byokProvidersList}>
              <span className={styles.byokProviderPill}>Anthropic</span>
              <span className={styles.byokProviderPill}>OpenAI</span>
              <span className={styles.byokProviderPill}>ElevenLabs</span>
              <span className={styles.byokProviderPill}>PlayHT</span>
              <span className={styles.byokProviderPill}>Cartesia</span>
              <span className={styles.byokProviderPill}>Hume</span>
            </div>
          </div>
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
          {isAuthenticated ? (
            <div className={styles.heroCtas}>
              <Link href="/feed" className={styles.btnPrimary}>
                Explore the Feed
              </Link>
              <Link href="/dashboard" className={styles.btnGhost}>
                Dashboard
              </Link>
            </div>
          ) : waitlistSubmitted ? (
            <div className={styles.waitlistSuccess}>
              You&apos;re on the list! We&apos;ll email you when your spot is ready.
            </div>
          ) : (
            <div className={styles.waitlistFormWrap}>
              <form className={styles.waitlistForm} onSubmit={(e) => handleWaitlistSubmit(e, 'cta')}>
                <input
                  className={styles.waitlistInput}
                  type="email"
                  placeholder="your@email.com"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  required
                  aria-label="Email address"
                />
                <input
                  className={styles.waitlistInput}
                  type="text"
                  placeholder="@twitter (optional)"
                  value={waitlistTwitter}
                  onChange={(e) => setWaitlistTwitter(e.target.value)}
                  aria-label="Twitter handle"
                />
                <button className={styles.waitlistSubmit} type="submit" disabled={waitlistLoading}>
                  {waitlistLoading ? 'Joining...' : 'Join the Waitlist'}
                </button>
              </form>
              {waitlistError && <p className={styles.waitlistError}>{waitlistError}</p>}
              <div className={styles.waitlistLinks}>
                <Link href="/feed" className={styles.waitlistLink}>Explore the Feed</Link>
                <Link href="/auth/login" className={styles.waitlistLink}>Sign In</Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ====== POWERED BY ====== */}
      <section
        className={`${styles.section} ${styles.sectionAlt} ${styles.rev}`}
        aria-label="Powered by"
      >
        <PoweredByProviders />
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
              <Link href="/voices">Voices</Link>
              <a href="/pricing">Pricing</a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="/feedback" className={styles.footerFeedback}>
                Share Feedback
              </a>
              <a href="/about">About</a>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/join">Join Us</a>
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
