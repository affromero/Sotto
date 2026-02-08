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
    answer: 'Absolutely. The Free plan lets you create up to 3 podcasts per month with up to 10 minutes each. No credit card required.',
  },
  {
    question: 'What happens when I hit my podcast limit?',
    answer: 'You can still listen to and interact with existing podcasts. To create new ones, wait for the next billing cycle or upgrade your plan.',
  },
  {
    question: 'Can I cancel my subscription anytime?',
    answer: 'Yes. You can cancel at any time from your billing settings. Your plan remains active until the end of the current billing period.',
  },
  {
    question: 'What are interactions?',
    answer: 'Interactions let you pause a podcast and ask a question. The AI answers using the podcast context. Free users get 3 per podcast; Pro and Team users get unlimited.',
  },
  {
    question: 'What does forking a podcast mean?',
    answer: 'Forking creates a copy of a public podcast that you can modify, like adding your own questions and regenerating sections. It is like remixing content.',
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
