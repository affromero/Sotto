import Link from 'next/link';
import { BRAND } from '@sotto/shared';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import { LanguageDemo } from './LanguageDemo';
import styles from './page.module.css';

export const metadata = {
  title: `Language Learning — ${BRAND.name}`,
  description:
    'Learn any language through audio lessons. Sotto highlights vocabulary inline, tracks your progress with spaced repetition, and supports 30+ languages at every level.',
};

const MODES = [
  {
    key: 'vocabulary_intro',
    title: 'Vocabulary Introduction',
    description:
      'Mostly in your native language with key foreign words woven in. Each word is highlighted with pronunciation, meaning, and an example sentence. Great for absolute beginners.',
  },
  {
    key: 'conversational_mix',
    title: 'Conversational Mix',
    description:
      'A balanced blend of your language and the target language. Sentences alternate naturally so you absorb grammar and phrasing through context, not drills.',
  },
  {
    key: 'full_immersion',
    title: 'Full Immersion',
    description:
      'The entire lesson is in your target language. Vocabulary highlights still appear in the transcript so you can look up any word, but the audio is fully immersive.',
  },
] as const;

const STEPS = [
  {
    number: '1',
    title: 'Pick a language',
    description:
      'Choose from 30+ languages when you create a lesson. Sotto generates the script, vocabulary, and audio in the language you pick.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8l6 6" />
        <path d="M4 14l6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
      </svg>
    ),
  },
  {
    number: '2',
    title: 'Choose your level',
    description:
      'Select a mix mode: vocabulary introduction for beginners, conversational mix for intermediates, or full immersion for advanced learners.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
      </svg>
    ),
  },
  {
    number: '3',
    title: 'Learn while listening',
    description:
      'Press play and learn naturally. Foreign words are highlighted inline with hover translations, pronunciation guides, and example sentences.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
] as const;

export default function LanguagesPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <p className={styles.overline}>Language Learning</p>
            <h1 className={styles.title}>
              Learn any language
              <br />
              while you listen.
            </h1>
            <p className={styles.subtitle}>
              Generate lessons in 30+ languages with inline vocabulary
              highlighting, hover translations, and spaced repetition. Pick a
              topic you care about and learn a language through it — no
              textbooks, no flashcard apps, just press play.
            </p>
          </header>

          {/* Interactive demo */}
          <section className={styles.demo}>
            <LanguageDemo />
          </section>

          {/* Mix modes */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Three ways to learn</h2>
            <p className={styles.sectionText}>
              Choose how much of the lesson is in your target language. Start
              gentle and ramp up as your confidence grows.
            </p>
            <div className={styles.modes}>
              {MODES.map((mode) => (
                <div key={mode.key} className={styles.modeCard}>
                  <h3 className={styles.modeTitle}>{mode.title}</h3>
                  <p className={styles.modeDescription}>{mode.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* How it works */}
          <section className={styles.steps}>
            {STEPS.map((step) => (
              <div key={step.number} className={styles.step}>
                <div className={styles.stepIcon} aria-hidden="true">
                  {step.icon}
                </div>
                <div className={styles.stepContent}>
                  <span className={styles.stepNumber}>Step {step.number}</span>
                  <h2 className={styles.stepTitle}>{step.title}</h2>
                  <p className={styles.stepDescription}>{step.description}</p>
                </div>
              </div>
            ))}
          </section>

          {/* CTA */}
          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Start Learning</h2>
            <p className={styles.ctaText}>
              Pick a language, choose a topic, and your first lesson is ready in
              minutes.
            </p>
            <Link href="/dashboard" className={styles.ctaButton}>
              Start Learning
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
