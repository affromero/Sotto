import styles from './page.module.css';

export const metadata = {
  title: 'Privacy Policy — Sotto',
  description: 'How Sotto collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.subtitle}>
            Your privacy matters. Here&apos;s how we handle your data.
          </p>
          <p className={styles.lastUpdated}>Last updated: February 15, 2026</p>
        </header>

        <div className={styles.content}>
          <h2>1. Information We Collect</h2>
          <h3>Account Information</h3>
          <p>
            When you sign up, we collect your email address, name, and profile
            information from your OAuth provider (Google, GitHub, or Apple).
          </p>

          <h3>Content You Create</h3>
          <p>
            We store podcasts you generate, discovery chat conversations, comments,
            interactions (questions and answers), and collections you create.
          </p>

          <h3>Usage Data</h3>
          <p>
            We collect playback analytics (play count, listen duration, completion rate),
            device information, and interaction patterns to improve the service and
            provide personalized recommendations.
          </p>

          <h2>2. BYOK (Bring Your Own Key)</h2>
          <p>
            Sotto uses a BYOK model. You provide your own API keys for AI providers
            (Anthropic, OpenAI) and TTS providers (ElevenLabs, OpenAI, PlayHT,
            Cartesia, Hume). Your keys are encrypted using <strong>AES-256-GCM</strong>{' '}
            before storage and are never logged, shared, or used for any purpose other
            than processing your requests.
          </p>
          <p>
            API calls made with your keys are sent directly to the respective providers.
            Sotto does not store the content of those API calls beyond what is necessary
            to deliver your podcast.
          </p>

          <h2>3. How We Use Your Information</h2>
          <ul>
            <li>Generate and deliver podcasts you request</li>
            <li>Provide the social feed, discovery, and recommendation features</li>
            <li>Send notifications about your podcasts and interactions</li>
            <li>Improve service quality and fix bugs</li>
            <li>Prevent abuse and enforce rate limits</li>
          </ul>

          <h2>4. Third-Party Services</h2>
          <p>We use the following third-party services:</p>
          <ul>
            <li><strong>AI Providers</strong> (Anthropic, OpenAI) — podcast script generation, Q&amp;A</li>
            <li><strong>TTS Providers</strong> (ElevenLabs, OpenAI, PlayHT, Cartesia, Hume) — audio generation</li>
            <li><strong>Cloudflare R2</strong> — audio and PDF file storage</li>
            <li><strong>OAuth Providers</strong> (Google, GitHub, Apple) — authentication and account linking (Twitter)</li>
          </ul>
          <p>
            Each third-party service has its own privacy policy. Your BYOK keys are
            used to authenticate directly with these providers on your behalf.
          </p>

          <h2>5. AI-Generated Content</h2>
          <p>
            Sotto generates podcast content using AI. All AI-generated podcasts are
            labeled as such. Imported human-created content is labeled accordingly.
            Sotto does not claim ownership of AI-generated content — you retain rights
            to podcasts you create.
          </p>

          <h2>6. Data Storage and Security</h2>
          <ul>
            <li>Data is stored on servers hosted in the EU (Hetzner)</li>
            <li>BYOK keys are encrypted with AES-256-GCM at rest</li>
            <li>All connections use HTTPS/TLS</li>
            <li>Database access is restricted to application services only</li>
          </ul>

          <h2>7. Your Rights</h2>
          <h3>Account Deletion</h3>
          <p>
            You can delete your account at any time from your profile settings. This
            permanently removes your profile, podcasts, interactions, comments, and all
            associated data. Audio files are queued for deletion from storage.
          </p>

          <h3>Data Export</h3>
          <p>
            You can download your podcast audio files and transcript PDFs at any time
            from the podcast player page.
          </p>

          <h3>BYOK Key Removal</h3>
          <p>
            You can remove your API keys at any time from the billing settings page.
            Removed keys are immediately deleted from our encrypted storage.
          </p>

          <h2>8. Cookies</h2>
          <p>
            We use essential cookies for authentication (session tokens). We do not use
            third-party tracking cookies or advertising cookies.
          </p>

          <h2>9. Children</h2>
          <p>
            Sotto is not intended for children under 13. We do not knowingly collect
            data from children under 13.
          </p>

          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Significant changes will be
            communicated via in-app notification.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions about this policy? Email us at{' '}
            <a href="mailto:support@sotto.fm">support@sotto.fm</a>.
          </p>
        </div>
      </div>
    </main>
  );
}
