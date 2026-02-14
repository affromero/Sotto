import type { Metadata } from 'next';
import { TierComparison } from '@/components/pricing/TierComparison';
import { PricingClient } from './PricingClient';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Choose the right Sotto plan for you. Start free with 3 credits, upgrade when you need more podcasts and features.',
};

const faqs = [
  {
    question: 'Can I try Sotto for free?',
    answer:
      'The Free plan gives you 3 credits per month with up to 5-minute podcasts. No credit card required.',
  },
  {
    question: 'What are credits?',
    answer:
      'Each credit lets you generate one podcast. Interactions cost 0.25 credits each. Importing a podcast costs 0.5 credits. Your plan includes monthly credits that roll over up to your plan\u2019s cap.',
  },
  {
    question: 'What is the Power (BYOK) plan?',
    answer:
      'BYOK means "Bring Your Own Key." The Power plan is $9/month and gives you 50 credits, but requires you to provide your own ElevenLabs API key. Sotto uses your key for text-to-speech generation, so our cost per podcast drops significantly. You get all Pro features plus the highest credit allowance.',
  },
  {
    question: 'How do I set up my ElevenLabs key?',
    answer:
      'After subscribing to the Power plan, go to Settings > API Keys and paste your ElevenLabs API key. We encrypt it with AES-256-GCM and never store it in plaintext. You can remove it anytime.',
  },
  {
    question: 'What are standard vs premium voices?',
    answer:
      'All podcasts use high-quality standard AI voices by default. Premium voices (powered by ElevenLabs) offer more natural, expressive audio and include access to the full voice library and personal voice cloning.',
  },
  {
    question: 'Can I clone my own voice?',
    answer: 'Starter users can clone 1 voice, Pro gets 3, Studio and Power get 10.',
  },
  {
    question: 'Can I import my own podcasts?',
    answer:
      'Yes! Import any MP3 \u2014 human-made or AI-generated \u2014 and Sotto adds the full social layer: transcription, fork, follow, interact, and share. Imports cost 0.5 credits.',
  },
  {
    question: 'What are interactions?',
    answer:
      'Interactions let you pause a podcast and ask a question. Each interaction costs 0.25 credits. The AI answers using the podcast context.',
  },
  {
    question: 'Do you offer refunds?',
    answer:
      'Yes, we offer a full refund within 7 days of subscribing if you are not satisfied. Contact us at support@sotto.fm.',
  },
];

export default function PricingPage() {
  return (
    <main className={styles.main}>
      {/* Hero */}
      <section className={styles.hero}>
        <h1 className={styles.title}>Choose Your Plan</h1>
        <p className={styles.subtitle}>
          Start free with 3 credits, upgrade when you need more. All plans include unlimited
          listening and full feed access.
        </p>
      </section>

      {/* Pricing Cards */}
      <PricingClient />

      {/* How Credits Work */}
      <section className={styles.creditSection}>
        <h2 className={styles.creditHeading}>How Credits Work</h2>
        <p className={styles.creditSubheading}>1 credit = 1 podcast. Simple.</p>
        <table className={styles.creditTable}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Credit Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Generate a podcast</td>
              <td>1 credit</td>
            </tr>
            <tr>
              <td>Import a podcast</td>
              <td>0.5 credits</td>
            </tr>
            <tr>
              <td>Ask a question (interaction)</td>
              <td>0.25 credits</td>
            </tr>
            <tr>
              <td>Listen to any podcast</td>
              <td>Free</td>
            </tr>
            <tr>
              <td>Fork a podcast</td>
              <td>1 credit</td>
            </tr>
            <tr>
              <td>Download MP3 / PDF</td>
              <td>Free (tier feature)</td>
            </tr>
          </tbody>
        </table>
        <p className={styles.creditFootnote}>
          Unused credits roll over each month, up to your plan&apos;s rollover cap.
        </p>
      </section>

      {/* Tier Comparison */}
      <section className={styles.comparisonSection}>
        <h2 className={styles.sectionTitle}>Compare Plans</h2>
        <TierComparison />
      </section>

      {/* FAQ */}
      <section className={styles.faqSection}>
        <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
        <div className={styles.faqGrid}>
          {faqs.map((faq) => (
            <div key={faq.question} className={styles.faqItem}>
              <h3 className={styles.faqQuestion}>{faq.question}</h3>
              <p className={styles.faqAnswer}>{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className={styles.bottomCta}>
        <h2 className={styles.ctaTitle}>Ready to get started?</h2>
        <p className={styles.ctaSubtitle}>
          Create your first AI podcast in minutes. No credit card required.
        </p>
        <a href="/create" className={styles.ctaButton}>
          Start Free
        </a>
      </section>
    </main>
  );
}
