import Link from 'next/link';
import { BRAND } from '@sotto/shared';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: `Daily Briefings — ${BRAND.name}`,
  description:
    'Create multiple personalized podcast briefings — morning tech news, evening finance, weekend deep dives. Sotto curates the stories you care about and turns them into conversational podcasts.',
};

const STEPS = [
  {
    number: '1',
    title: 'Pick your topics',
    description:
      'Choose the subjects you follow — AI, finance, climate, sports, whatever matters to you. Add custom instructions to focus on specific angles.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    number: '2',
    title: 'Set your schedule',
    description:
      'Name each briefing, choose a delivery time and which days of the week. Each one runs independently on its own schedule.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    number: '3',
    title: 'Listen over coffee',
    description:
      'A two-voice conversational podcast lands in your feed every morning. Play it on your commute, during breakfast, or at the gym.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
] as const;

const OPTIONS = [
  {
    label: 'Depth',
    values: ['ELI5', 'Quick Overview', 'Standard', 'Deep Dive'],
  },
  {
    label: 'Tone',
    values: ['Casual', 'Professional', 'Socratic', 'Comedic', 'Satirical', 'Storytelling'],
  },
  {
    label: 'Duration',
    values: ['3 min', '6 min', '10 min', '15 min', '20 min', '30 min'],
  },
  {
    label: 'Audience',
    values: ['Beginner', 'Intermediate', 'Expert'],
  },
] as const;

const EXAMPLES = [
  {
    topic: 'AI & Machine Learning',
    instruction: '"Focus on new model releases and open-source tooling"',
    result: 'A 6-minute briefing covering the latest research papers, product launches, and community discussions.',
  },
  {
    topic: 'Startup Fundraising',
    instruction: '"Track Series A and B rounds in developer tools"',
    result: 'Daily coverage of funding rounds, investor moves, and market trends in the dev tools space.',
  },
  {
    topic: 'Climate & Energy',
    instruction: '"Policy developments and clean energy breakthroughs"',
    result: 'A morning rundown of legislative updates, new technologies, and global energy market shifts.',
  },
] as const;

export default function BriefingsPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <p className={styles.overline}>Daily Briefings</p>
            <h1 className={styles.heroTitle}>
              Your podcasts,
              <br />
              built overnight.
            </h1>
            <p className={styles.heroSubtitle}>
              Create up to 5 personalized briefings — morning tech news, evening
              finance, weekend deep dives. Sotto reads the stories while you sleep
              and turns them into conversational podcasts. No scrolling, no
              skimming — just press play.
            </p>
          </header>

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

          {/* Customization */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Make it yours</h2>
            <p className={styles.sectionText}>
              Every briefing is shaped by your preferences. Choose how deep, how long,
              and what tone fits your morning. Change any setting whenever you
              want — tomorrow&apos;s briefing picks up your latest preferences.
            </p>
            <div className={styles.optionGrid}>
              {OPTIONS.map((option) => (
                <div key={option.label} className={styles.optionCard}>
                  <h3 className={styles.optionLabel}>{option.label}</h3>
                  <div className={styles.optionValues}>
                    {option.values.map((value) => (
                      <span key={value} className={styles.optionChip}>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className={styles.sectionTextSmall}>
              You can also pick your voices, choose an AI model, and write custom
              instructions to steer the conversation toward what matters most.
            </p>
          </section>

          {/* Examples */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Example briefings</h2>
            <p className={styles.sectionText}>
              Add custom instructions to focus your briefing on exactly what you need.
            </p>
            <div className={styles.examples}>
              {EXAMPLES.map((example) => (
                <div key={example.topic} className={styles.exampleCard}>
                  <h3 className={styles.exampleTopic}>{example.topic}</h3>
                  <p className={styles.exampleInstruction}>{example.instruction}</p>
                  <p className={styles.exampleResult}>{example.result}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Set it and forget it */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Set it once, done.</h2>
            <p className={styles.sectionText}>
              Configure your briefing in settings and it runs every day on autopilot.
              No daily input, no prompts to fill out. It just shows up. If you want
              to hear something different tomorrow, tweak any control and the next
              briefing picks it up.
            </p>
            <p className={styles.sectionText}>
              Want a podcast on a topic your briefing didn&apos;t cover? Just{' '}
              <a href="/create">create one</a> — describe what you want to hear
              and it&apos;s ready in minutes.
            </p>
          </section>

          {/* BYOK */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Works with your own keys</h2>
            <p className={styles.sectionText}>
              Briefings use platform AI by default during early access. Bring your own
              API keys for unlimited daily briefings at your provider&apos;s rates — connect
              Anthropic, OpenAI, or any supported provider.
            </p>
          </section>

          {/* CTA */}
          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Try your first briefing</h2>
            <p className={styles.ctaText}>
              Sign up, pick your topics, and set a delivery time. Your first briefing
              arrives tomorrow morning.
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
