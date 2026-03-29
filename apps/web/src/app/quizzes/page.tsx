import Link from 'next/link';
import { BRAND } from '@sotto/shared';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: `Quizzes — ${BRAND.name}`,
  description:
    'Test what you learned after every podcast. Sotto generates comprehension quizzes automatically so you retain more of what you listen to.',
};

const QUIZ_FEATURES = [
  {
    title: 'Auto-generated after every podcast',
    description:
      'When your podcast finishes generating, a comprehension quiz is created from the script. No setup needed — it just appears when you finish listening.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    title: 'Scaled to podcast length',
    description:
      '3 questions for short episodes, up to 5 for longer ones. Difficulty is mixed — easy, medium, and hard — so every listener is challenged.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    title: 'Comprehension, not trivia',
    description:
      'Questions test real understanding — main arguments, causal reasoning, key distinctions between concepts. Not "what year was X born?"',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
] as const;

const FLOW_STEPS = [
  {
    step: '1',
    label: 'Finish listening',
    detail: 'Complete a podcast episode.',
  },
  {
    step: '2',
    label: 'Rate the episode',
    detail: 'A quick star rating appears first.',
  },
  {
    step: '3',
    label: 'Take the quiz',
    detail: 'Answer one question at a time with keyboard shortcuts (1-4).',
  },
  {
    step: '4',
    label: 'See your results',
    detail: 'Review your score, see explanations for wrong answers.',
  },
] as const;

export default function QuizzesPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <p className={styles.overline}>Quizzes</p>
            <h1 className={styles.heroTitle}>
              Listen. Learn.
              <br />
              Prove it.
            </h1>
            <p className={styles.heroSubtitle}>
              Every podcast on Sotto comes with a comprehension quiz. Finish
              an episode, test what you absorbed, and track your learning over
              time.
            </p>
          </header>

          {/* Post-listen quiz features */}
          <section className={styles.features}>
            {QUIZ_FEATURES.map((feature) => (
              <div key={feature.title} className={styles.feature}>
                <div className={styles.featureIcon} aria-hidden="true">
                  {feature.icon}
                </div>
                <h2 className={styles.featureTitle}>{feature.title}</h2>
                <p className={styles.featureDescription}>{feature.description}</p>
              </div>
            ))}
          </section>

          {/* How the flow works */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>How it works</h2>
            <div className={styles.flow}>
              {FLOW_STEPS.map((item, i) => (
                <div key={item.step} className={styles.flowStep}>
                  <div className={styles.flowIndicator}>
                    <span className={styles.flowDot}>{item.step}</span>
                    {i < FLOW_STEPS.length - 1 && (
                      <div className={styles.flowLine} aria-hidden="true" />
                    )}
                  </div>
                  <div className={styles.flowContent}>
                    <h3 className={styles.flowLabel}>{item.label}</h3>
                    <p className={styles.flowDetail}>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Learning stats */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Track your progress</h2>
            <p className={styles.sectionText}>
              Your learning stats are tracked across every quiz you take — total
              quizzes completed, average score, correct answers, and a history
              of recent attempts. Each podcast also shows the community average
              so you can see how you compare.
            </p>
          </section>

          {/* Taste Quiz */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Taste Quiz</h2>
            <p className={styles.sectionText}>
              When you sign up, a quick yes-or-no quiz learns what topics grab
              your attention. Swipe through 10 cards in 30 seconds. The results
              shape your feed recommendations and surface podcasts you&apos;ll
              actually want to hear. You can retake it anytime from settings.
            </p>
          </section>

          {/* Optional */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Totally optional</h2>
            <p className={styles.sectionText}>
              Quizzes appear after you finish listening but you can turn them off
              in settings with a single toggle. No pressure — they&apos;re there
              when you want them.
            </p>
          </section>

          {/* CTA */}
          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Start listening and learning</h2>
            <p className={styles.ctaText}>
              Sign up, create or discover a podcast, and take your first quiz
              after you finish the episode.
            </p>
            <Link href="/auth/signup" className={styles.ctaButton}>
              Get started
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
