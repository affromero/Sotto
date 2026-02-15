import styles from './page.module.css';

export const metadata = {
  title: 'Terms of Service — Sotto',
  description: 'Terms and conditions for using Sotto.',
};

export default function TermsPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Terms of Service</h1>
          <p className={styles.subtitle}>
            By using Sotto, you agree to these terms.
          </p>
          <p className={styles.lastUpdated}>Last updated: February 15, 2026</p>
        </header>

        <div className={styles.content}>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using Sotto (&quot;the Service&quot;), you agree to be bound
            by these Terms of Service. If you do not agree, do not use the Service.
          </p>

          <h2>2. Description of Service</h2>
          <p>
            Sotto is an open podcast network that enables users to generate AI-powered
            conversational podcasts, interact with content during playback, fork and
            remix existing podcasts, and share knowledge publicly.
          </p>

          <h2>3. BYOK Model and API Keys</h2>
          <p>
            Sotto operates on a Bring Your Own Key (BYOK) model. You are responsible
            for providing your own API keys for AI and TTS providers. You are solely
            responsible for:
          </p>
          <ul>
            <li>The costs incurred by your API key usage</li>
            <li>Complying with each provider&apos;s terms of service</li>
            <li>Keeping your API keys secure</li>
          </ul>
          <p>
            Sotto encrypts your keys at rest but is not liable for charges incurred
            through your keys.
          </p>

          <h2>4. AI-Generated Content</h2>
          <p>
            Podcasts generated through Sotto are created using AI models. You
            acknowledge that:
          </p>
          <ul>
            <li>AI-generated content may contain inaccuracies or errors</li>
            <li>AI content is labeled as &quot;AI-Generated&quot; on the platform</li>
            <li>You should not rely on AI-generated podcasts as authoritative sources</li>
            <li>
              Sotto includes a script verification step, but this does not guarantee
              factual accuracy
            </li>
          </ul>

          <h2>5. User Content and Ownership</h2>
          <p>
            You retain ownership of podcasts you create or import. By making content
            public, you grant other users the right to listen, fork, and remix your
            podcasts (with attribution). You may set podcasts to private or unlisted
            at any time.
          </p>

          <h2>6. Acceptable Use</h2>
          <p>You agree not to use Sotto to:</p>
          <ul>
            <li>Generate content that is illegal, harmful, or violates others&apos; rights</li>
            <li>Impersonate individuals or misrepresent AI content as human-created</li>
            <li>Attempt to circumvent rate limits or abuse the service</li>
            <li>Use voice cloning features without the consent of the voice owner</li>
            <li>Upload content you do not have the right to distribute</li>
            <li>Engage in harassment, hate speech, or discrimination</li>
          </ul>

          <h2>7. Forking and Remixing</h2>
          <p>
            Sotto allows users to fork public podcasts. Forks are attributed to the
            original creator. Forking does not transfer ownership of the original
            content. The original creator may make their podcast private at any time,
            but existing forks remain accessible.
          </p>

          <h2>8. Account Termination</h2>
          <p>
            You may delete your account at any time from your profile settings. We may
            suspend or terminate accounts that violate these terms. Upon deletion, your
            data is permanently removed as described in our{' '}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>9. Disclaimers</h2>
          <p>
            Sotto is provided &quot;as is&quot; without warranties of any kind. We do not
            guarantee uptime, accuracy of AI-generated content, or availability of
            third-party services (AI providers, TTS providers).
          </p>

          <h2>10. Limitation of Liability</h2>
          <p>
            Sotto is not liable for any damages arising from your use of the service,
            including costs incurred through BYOK API key usage, data loss, or
            inaccuracies in AI-generated content.
          </p>

          <h2>11. Changes to Terms</h2>
          <p>
            We may update these terms from time to time. Continued use of the service
            after changes constitutes acceptance of the new terms.
          </p>

          <h2>12. Contact</h2>
          <p>
            Questions about these terms? Email us at{' '}
            <a href="mailto:support@sotto.fm">support@sotto.fm</a>.
          </p>
        </div>
      </div>
    </main>
  );
}
