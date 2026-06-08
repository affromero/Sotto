import Link from 'next/link';
import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Pricing — Sotto',
  description:
    'Sotto is free to start. Create up to 3 AI podcasts per day, up to 10 minutes each. No credit card required.',
};

export default function PricingPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.hero}>
            <h1 className={styles.heroTitle}>Free to start.</h1>
            <p className={styles.heroSubtitle}>
              Sign up and start creating podcasts in seconds. No credit card, no
              approval process. Upgrade when you need more.
            </p>
          </header>

          <section className={styles.plans}>
            <div className={`${styles.plan} ${styles.planFeatured}`}>
              <div className={styles.planBadge}>Free</div>
              <div className={styles.planHeader}>
                <h2 className={styles.planName}>Starter</h2>
                <p className={styles.planPrice}>$0 / month</p>
              </div>
              <p className={styles.planDescription}>
                Everything you need to create and listen to private AI podcasts.
              </p>
              <ul className={styles.planFeatures}>
                <li>3 podcasts per day</li>
                <li>Up to 10 minutes each</li>
                <li>Platform AI + voices included</li>
                <li>Web search for current information</li>
                <li>Q&amp;A interactions while listening</li>
                <li>Private and unlisted podcasts</li>
                <li>Listen across web and mobile</li>
                <li>Collections and saved library tools</li>
              </ul>
              <Link href="/auth/signup" className={styles.planButton}>
                Sign up free
              </Link>
            </div>
          </section>

          <section className={styles.cta}>
            <h2 className={styles.ctaTitle}>Ready to start?</h2>
            <p className={styles.ctaText}>
              Create your first podcast in under a minute.
            </p>
            <div className={styles.ctaButtons}>
              <Link href="/auth/signup" className={styles.ctaButtonPrimary}>
                Sign up free
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
