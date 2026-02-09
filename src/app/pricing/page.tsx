import type { Metadata } from 'next';
import { TierComparison } from '@/components/pricing/TierComparison';
import { PricingClient } from './PricingClient';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Choose the right Sotto plan for you. Start free, upgrade when you need more podcasts and features.',
};

const faqs = [
  {
    question: 'Can I try Sotto for free?',
    answer: 'Absolutely. The Free plan lets you create up to 2 podcasts per month with up to 10 minutes each. No credit card required.',
  },
  {
    question: 'What are standard vs premium voices?',
    answer: 'All podcasts use high-quality standard AI voices by default. Premium voices (powered by ElevenLabs) offer more natural, expressive audio and include access to the full voice library and personal voice cloning.',
  },
  {
    question: 'What are premium voice credits?',
    answer: 'Each premium voice credit lets you generate one podcast with ElevenLabs premium voices. Pro gets 3 credits per month, Creator gets 10. Standard voice generation is always unlimited.',
  },
  {
    question: 'Can I clone my own voice?',
    answer: 'Yes! Pro users can clone up to 2 personal voices, and Creator users can clone up to 5. Upload a short audio sample and your voice becomes available for your podcasts.',
  },
  {
    question: 'What are interactions?',
    answer: 'Interactions let you pause a podcast and ask a question. The AI answers using the podcast context. Free users get 2 per podcast, Pro gets 10, and Creator users get unlimited.',
  },
  {
    question: 'Do you offer refunds?',
    answer: 'Yes, we offer a full refund within 7 days of subscribing if you are not satisfied. Contact us at support@sotto.fm.',
  },
];

export default function PricingPage() {
  return (
    <main className={styles.main}>
      {/* Hero */}
      <section className={styles.hero}>
        <h1 className={styles.title}>Choose Your Plan</h1>
        <p className={styles.subtitle}>
          Start free, upgrade when you need more. All plans include unlimited listening and full feed access.
        </p>
      </section>

      {/* Pricing Cards */}
      <PricingClient />

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
