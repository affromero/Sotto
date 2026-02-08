import styles from './page.module.css';

export default function LandingPage() {
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Podcasts That Listen Back</h1>
        <p className={styles.subtitle}>
          Generate AI podcasts from any topic. Interrupt to ask questions.
          Share knowledge with the world.
        </p>
        <div className={styles.actions}>
          <a href="/create" className={styles.primaryCta}>
            Create Your First Podcast
          </a>
          <a href="/feed" className={styles.secondaryCta}>
            Explore Podcasts
          </a>
        </div>
      </section>

      <section className={styles.howItWorks}>
        <h2>How It Works</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.stepNumber}>1</span>
            <h3>Chat About Your Topic</h3>
            <p>Tell Sotto what you want to learn. Our AI asks smart questions to tailor your podcast perfectly.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNumber}>2</span>
            <h3>Listen & Interact</h3>
            <p>A two-voice podcast is generated just for you. Pause anytime to ask questions — Sotto answers in context.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNumber}>3</span>
            <h3>Share & Discover</h3>
            <p>Your podcasts are public by default. Discover what others are learning, follow creators, fork and remix.</p>
          </div>
        </div>
      </section>

      <section className={styles.pricing}>
        <h2>Simple Pricing</h2>
        <div className={styles.tiers}>
          <div className={styles.tier}>
            <h3>Free</h3>
            <p className={styles.price}>$0</p>
            <ul>
              <li>3 podcasts/month</li>
              <li>Up to 10 minutes each</li>
              <li>Unlimited listening</li>
              <li>Public feed access</li>
            </ul>
          </div>
          <div className={`${styles.tier} ${styles.featured}`}>
            <h3>Pro</h3>
            <p className={styles.price}>$19<span>/mo</span></p>
            <ul>
              <li>20 podcasts/month</li>
              <li>Up to 30 minutes each</li>
              <li>Unlimited interactions</li>
              <li>Private podcasts</li>
              <li>Download MP3s</li>
            </ul>
          </div>
          <div className={styles.tier}>
            <h3>Team</h3>
            <p className={styles.price}>$49<span>/mo</span></p>
            <ul>
              <li>Unlimited podcasts</li>
              <li>10 team seats</li>
              <li>Private team feed</li>
              <li>API access</li>
              <li>Analytics dashboard</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
