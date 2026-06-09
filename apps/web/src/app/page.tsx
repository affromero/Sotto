import Link from 'next/link';
import { Newsreader, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { BRAND } from '@sotto/shared';
import { JsonLd } from '@/components/landing/JsonLd';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { LandingCTA } from '@/components/landing/LandingCTA';
import { GlassBead } from '@/components/landing/GlassBead';
import { Glyph } from '@/app/welcome/Glyph';
import type { GlyphName } from '@/app/welcome/data';
import { getPublicGithubUrl } from '@/lib/public-links';
import styles from './page.module.css';

const GITHUB_URL = getPublicGithubUrl() ?? 'https://github.com/affromero/Sotto';

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500'],
  variable: '--font-newsreader',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

interface Step {
  num: string;
  label: string;
  title: string;
  body: string;
  icon: GlyphName;
}

const STEPS: Step[] = [
  {
    num: '01',
    label: 'Connect',
    title: 'Bring your own agent',
    body: 'Point Sotto at the Claude or Codex you already run, with your own keys. No new account to teach, no provider lock-in. The model that knows your work teaches the language.',
    icon: 'plug',
  },
  {
    num: '02',
    label: 'Grant context',
    title: 'Choose what it may read',
    body: 'Hand it your repositories, papers, notes, the things you actually care about. You decide the scope, line by line. Nothing leaves your machine unless you say so.',
    icon: 'key',
  },
  {
    num: '03',
    label: 'Progress',
    title: 'A course gated by mastery',
    body: 'Get placed at the right CEFR level, then advance only as you demonstrate it. Grammar, reading, listening, speaking, and writing, drawn from your own world.',
    icon: 'gate',
  },
];

interface Skill {
  label: string;
  name: string;
  body: string;
  icon: GlyphName;
}

const SKILLS: Skill[] = [
  {
    label: 'Grammar',
    name: 'Structure, drilled',
    body: 'Mastery-gated grammar exercises that adapt to what you keep getting wrong.',
    icon: 'spark',
  },
  {
    label: 'Reading',
    name: 'Your own sources',
    body: 'Passages levelled to your CEFR step, built from the texts you brought.',
    icon: 'book',
  },
  {
    label: 'Listening',
    name: 'Adaptive audio',
    body: 'Generated audio lessons you can pause, question, and have re-explained aloud.',
    icon: 'wave',
  },
  {
    label: 'Speaking',
    name: 'Pronunciation feedback',
    body: 'Record a phrase; get phoneme-level feedback through your own STT and TTS.',
    icon: 'mic',
  },
  {
    label: 'Writing',
    name: 'Inline corrections',
    body: 'Write freely and receive corrections that explain the why, not just the what.',
    icon: 'check',
  },
  {
    label: 'Memory',
    name: 'A graph you own',
    body: 'Every word and grammar point tracked across skills, with spaced review when it is due.',
    icon: 'graph',
  },
];

interface Tenet {
  label: string;
  title: string;
  body: string;
  icon: GlyphName;
}

const TENETS: Tenet[] = [
  {
    label: 'Your keys',
    title: 'BYOK, end to end',
    body: 'Every provider call runs on credentials you hold. Swap models freely; no managed middleman skims the path.',
    icon: 'lock',
  },
  {
    label: 'Your data',
    title: 'Private by default',
    body: 'Your context, recordings, and vocabulary graph stay on your stack. There is no shared corpus to opt out of.',
    icon: 'shield',
  },
  {
    label: 'Your stack',
    title: 'Open and self-hostable',
    body: 'The whole thing is open-source and runs on infrastructure you control. Read it, audit it, host it.',
    icon: 'repo',
  },
];

export default function LandingPage() {
  return (
    <div
      className={`${newsreader.variable} ${ibmPlexMono.variable} ${ibmPlexSans.variable} ${styles.root}`}
    >
      <JsonLd />
        <LandingHeader />

        <main className={styles.main}>
          {/* ---- hero ---- */}
          <section className={styles.hero} aria-labelledby="hero-title">
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDash} aria-hidden="true" />
              Open-source · Self-hosted
            </p>
            <h1 id="hero-title" className={styles.heroTitle}>
              Learn a language, <em>taught in your own context.</em>
            </h1>
            <p className={styles.lede}>{BRAND.subline}</p>

            <LandingCTA withGhost />

            <p className={styles.whisper}>
              <span className={styles.whisperTag}>sotto voce</span>
              Spoken softly, kept private. The agent that already knows you, now
              teaching you to speak.
            </p>
          </section>

          {/* ---- how it works ---- */}
          <section className={styles.section} aria-labelledby="how-title">
            <header className={styles.sectionHead}>
              <p className={styles.sectionLabel}>How it works</p>
              <h2 id="how-title" className={styles.sectionTitle}>
                Three steps, and the course is <em>yours</em>.
              </h2>
            </header>

            <ol className={styles.steps}>
              {STEPS.map((step) => (
                <li key={step.num} className={styles.step}>
                  <div className={styles.stepIcon} aria-hidden="true">
                    <Glyph name={step.icon} size={20} />
                  </div>
                  <div className={styles.stepBody}>
                    <p className={styles.stepMeta}>
                      <span className={styles.stepNum}>{step.num}</span>
                      {step.label}
                    </p>
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                    <p className={styles.stepText}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ---- five skills + memory ---- */}
          <section className={styles.section} aria-labelledby="skills-title">
            <header className={styles.sectionHead}>
              <p className={styles.sectionLabel}>Five skills · one memory</p>
              <h2 id="skills-title" className={styles.sectionTitle}>
                Every skill, drawn from <em>your world</em>.
              </h2>
              <p className={styles.sectionLede}>
                Grammar, reading, listening, speaking, and writing, each gated by
                demonstrated mastery, all feeding a vocabulary memory graph that is
                entirely yours.
              </p>
            </header>

            <ul className={styles.skillGrid}>
              {SKILLS.map((skill) => (
                <li key={skill.label} className={styles.skillCard}>
                  <div className={styles.skillIcon} aria-hidden="true">
                    <Glyph name={skill.icon} size={20} />
                  </div>
                  <p className={styles.skillLabel}>{skill.label}</p>
                  <h3 className={styles.skillName}>{skill.name}</h3>
                  <p className={styles.skillText}>{skill.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* ---- ownership ---- */}
          <section className={styles.section} aria-labelledby="own-title">
            <header className={styles.sectionHead}>
              <p className={styles.sectionLabel}>Ownership</p>
              <h2 id="own-title" className={styles.sectionTitle}>
                Your keys, your data, <em>your stack</em>.
              </h2>
              <p className={styles.sectionLede}>
                There is no social layer here. No feeds, no follows, no likes. Just
                a learning stack you fully control.
              </p>
            </header>

            <div className={styles.tenetGrid}>
              {TENETS.map((tenet) => (
                <article key={tenet.label} className={styles.tenet}>
                  <div className={styles.tenetIcon} aria-hidden="true">
                    <Glyph name={tenet.icon} size={20} />
                  </div>
                  <p className={styles.tenetLabel}>{tenet.label}</p>
                  <h3 className={styles.tenetTitle}>{tenet.title}</h3>
                  <p className={styles.tenetText}>{tenet.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ---- footer CTA ---- */}
          <section className={styles.convert} aria-labelledby="convert-title">
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDash} aria-hidden="true" />
              {BRAND.cta}
            </p>
            <h2 id="convert-title" className={styles.convertTitle}>
              Place. Practice. <em>Progress.</em>
            </h2>
            <p className={styles.sectionLede}>
              Connect the agent you already own and take the first class today.
            </p>

            <LandingCTA />

            <p className={styles.whisper}>
              <span className={styles.whisperTag}>sotto voce</span>
              {BRAND.origin}.
            </p>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <Link href="/" className={styles.footerWordmark} aria-label="Sotto home">
              <GlassBead />
              <span className={styles.footerWordmarkText}>sotto</span>
            </Link>
            <nav className={styles.footerLinks} aria-label="Footer">
              <Link href="/about" className={styles.footerLink}>
                About
              </Link>
              <a
                href={GITHUB_URL}
                className={styles.footerLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href="https://www.gnu.org/licenses/agpl-3.0.html"
                className={styles.footerLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                AGPL-3.0
              </a>
            </nav>
            <p className={styles.footerNote}>
              {BRAND.name}. {BRAND.pitchTagline}
            </p>
          </div>
        </footer>
    </div>
  );
}
