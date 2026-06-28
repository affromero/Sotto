import { BRAND } from '@sotto/shared';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: `About ${BRAND.name}`,
  description: BRAND.description,
};

export default function AboutPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>{BRAND.tagline}</h1>
            <p className={styles.heroSubtitle}>
              Sotto is open source language learning you run yourself. It gives learners a private
              rehearsal space for the language they want to use before class, tutoring, or real
              conversation, on a stack they control.
            </p>
          </header>

          <section className={styles.features}>
            <div className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true">
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
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
                </svg>
              </div>
              <h2 className={styles.featureTitle}>Learn</h2>
              <p className={styles.featureDescription}>
                Get placed at the right CEFR level, then work through courses across five skills:
                grammar, reading, listening, speaking, and writing. Each course is gated by mastery
                and built from the context and situations you choose to share.
              </p>
            </div>

            <div className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true">
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
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="5" cy="6" r="2" />
                  <circle cx="19" cy="6" r="2" />
                  <circle cx="5" cy="18" r="2" />
                  <circle cx="19" cy="18" r="2" />
                  <path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" />
                </svg>
              </div>
              <h2 className={styles.featureTitle}>Rehearse</h2>
              <p className={styles.featureDescription}>
                Repeat speaking, listening, writing, and vocabulary practice privately before a
                human is waiting on the other side. Mistakes become material for the next attempt,
                not a performance.
              </p>
            </div>

            <div className={styles.feature}>
              <div className={styles.featureIcon} aria-hidden="true">
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
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className={styles.featureTitle}>Own</h2>
              <p className={styles.featureDescription}>
                Connect your own agent, Claude Code or Codex, and your own provider keys. Run the
                whole stack yourself. Your keys, your data, your progress. Nothing is shared unless
                you decide to share it.
              </p>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Free and Run by You</h2>
            <p className={styles.sectionText}>
              Sotto is free and open source. There is no subscription standing between you and your
              courses. You bring your own keys for AI and audio, and you pay those providers
              directly for what you use.
            </p>
            <p className={styles.sectionText}>
              Your keys are encrypted with AES-256-GCM on the instance you control. Because you run
              the stack, your learning data stays with you. You decide what your agent may read and
              what stays untouched.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Built for Low-Pressure Practice</h2>
            <p className={styles.sectionText}>
              Most language tools treat conversation as the starting point. Sotto treats it as the
              thing many learners need to rehearse for. A paper you are reading, a project you are
              shipping, a classroom topic, a travel scene, or a difficult conversation can become
              private practice first.
            </p>
            <p className={styles.sectionText}>
              It is also not another AI language chatbot. The useful surface is the learning loop
              around the model: classes, assigned rehearsal, recordings, rubrics, spaced repetition,
              and follow-up evidence that can survive beyond a single chat thread.
            </p>
            <p className={styles.sectionText}>
              That does not make Sotto a replacement for teachers, tutors, or classmates. It handles
              repetition, preparation, and gentle feedback so human learning moments can start from
              a stronger attempt.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>A Teacher-Run Path</h2>
            <p className={styles.sectionText}>
              In a classroom deployment, the self-hosted owner can become the teacher and learner
              profiles can become student spaces. The useful version of that mode is not an AI
              teacher; it is homework, class-prep scenarios, private retries, and follow-up notes
              the teacher can review before the next lesson.
            </p>
            <p className={styles.sectionText}>
              That keeps the product honest: Sotto creates practice evidence and lowers the social
              load between lessons, while the teacher keeps control over goals, rubrics, feedback,
              and what happens live.
            </p>
          </section>

          <section className={styles.contact}>
            <h2 className={styles.sectionTitle}>Get in Touch</h2>
            <p className={styles.sectionText}>
              Questions about running your own instance, or feedback on the courses? Reach the
              maintainers of your deployment at{' '}
              <a href="mailto:support@example.com">support@example.com</a>.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
