import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Join Us — Sotto',
  description:
    'Help build private AI podcast infrastructure. We\'re a small, remote-first team working on the future of how people keep up with knowledge.',
};

export default function JoinPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>Build the Future of Podcasting</h1>
            <p className={styles.heroSubtitle}>
              We&apos;re a small team with big ambitions, building the platform
              we wish existed.
            </p>
          </header>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Why Sotto Matters</h2>
            <p className={styles.sectionText}>
              Knowledge is locked up in formats that are hard to create and
              difficult to personalize. Writing a blog post takes hours. Recording a
              podcast takes weeks of planning. And once it&apos;s published, it&apos;s
              frozen — no one can reshape it for their own context.
            </p>
            <p className={styles.sectionText}>
              Sotto changes this. We believe anyone should be able to turn an
              idea into a rich, listenable conversation in minutes while keeping
              the underlying workflow portable. Open source works because people
              can inspect, adapt, and self-host the systems they depend on. We&apos;re
              bringing that ethos to podcasting.
            </p>
            <p className={styles.sectionText}>
              We&apos;re also deeply committed to openness. No vendor lock-in, no
              walled gardens. Users bring their own API keys, control their own
              costs, and own their content. We make the platform; you make
              it yours.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>What It&apos;s Like Here</h2>
            <ul className={styles.values}>
              <li className={styles.value}>
                <h3 className={styles.valueTitle}>Remote-first, async by default</h3>
                <p className={styles.valueDescription}>
                  Work from anywhere. We communicate through writing, ship
                  through PRs, and meet only when it actually helps.
                </p>
              </li>
              <li className={styles.value}>
                <h3 className={styles.valueTitle}>Small team, full ownership</h3>
                <p className={styles.valueDescription}>
                  No layers of management. You pick up problems, solve them,
                  and ship. Every person here shapes the product directly.
                </p>
              </li>
              <li className={styles.value}>
                <h3 className={styles.valueTitle}>Builder culture</h3>
                <p className={styles.valueDescription}>
                  We care about craft — clean code, thoughtful UX, systems that
                  scale. We&apos;d rather ship something excellent next week than
                  something mediocre today.
                </p>
              </li>
              <li className={styles.value}>
                <h3 className={styles.valueTitle}>AI-native, not AI-hype</h3>
                <p className={styles.valueDescription}>
                  AI is at the core of what we build, not a buzzword in our
                  pitch deck. We use it every day — to generate content, verify
                  claims, and make the product smarter.
                </p>
              </li>
            </ul>
          </section>

          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Interested?</h2>
            <p className={styles.ctaText}>
              We don&apos;t have a formal job board. If building private podcast
              infrastructure excites you — whether you&apos;re an engineer, designer,
              or something else entirely — we want to hear from you.
            </p>
            <a href="mailto:jobs@example.com" className={styles.ctaButton}>
              Reach out at jobs@example.com
            </a>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
