import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Privacy Policy. Sotto',
  description: 'How Sotto collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.subtitle}>
            Your privacy matters. Here&apos;s how we handle your data.
          </p>
          <p className={styles.lastUpdated}>Last updated: February 19, 2026</p>
        </header>

        <div className={styles.content}>
          <h2>1. Information We Collect</h2>

          <h3>Account Information</h3>
          <p>
            When you sign up, we collect your email address, name, and profile
            information from your OAuth provider (Google, GitHub, Apple, or Twitter/X).
          </p>

          <h3>Content You Create</h3>
          <p>
            We store lessons you generate, lesson creation chat conversations, scripts,
            interactions (questions and answers), and saved lesson ideas.
          </p>

          <h3>BYOK Keys</h3>
          <p>
            You provide your own API keys for AI providers (Anthropic, OpenAI) and TTS
            providers (ElevenLabs, OpenAI, Cartesia, Hume, Fal, Replicate).
            Your keys are encrypted using <strong>AES-256-GCM</strong> before storage
            and are never logged, shared, or used for any purpose other than processing
            your requests. API calls made with your keys are sent directly to the
            respective providers. Sotto does not store the content of those API calls
            beyond what is necessary to deliver your lesson.
          </p>

          <h3>Usage Data</h3>
          <p>
            We keep the operational records needed to deliver the service, including
            generated lessons, saved lessons, interactions, feedback, notifications,
            API usage logs, and provider-cost records.
          </p>
          <p>
            Sotto does not collect anonymous activity events or maintain
            behavior-derived profile storage.
          </p>

          <h2>2. Personalization</h2>
          <p>
            Learning personalization uses information you provide directly,
            such as interest-seeded sourced classes, course context, and saved lessons.
            Sotto does not maintain behavior-derived vectors or
            anonymous session profiles.
          </p>
          <p>
            No automated decisions with legal or similarly significant effects are
            made from personalization inputs. You can request deletion of this data
            at any time by deleting your account.
          </p>

          <h2>3. Legal Basis for Processing (GDPR)</h2>
          <ul>
            <li>
              <strong>Contract performance</strong>: processing necessary to provide
              your account, generate lessons, and deliver the service you requested
            </li>
            <li>
              <strong>Legitimate interest</strong>: learning personalization,
              abuse prevention, rate limiting, and service improvement. We balance
              these interests against your privacy rights and provide opt-out
              mechanisms where feasible.
            </li>
          </ul>

          <h2>4. How We Use Your Information</h2>
          <ul>
            <li>Generate and deliver lessons you request</li>
            <li>Provide private library, interest-seeded sourced classes, and course personalization</li>
            <li>Send notifications about your lessons and interactions</li>
            <li>Moderate content for safety and policy compliance</li>
            <li>Improve service quality, fix bugs, and analyze usage patterns</li>
            <li>Prevent abuse, enforce rate limits, and detect fraudulent activity</li>
          </ul>

          <h2>5. Third-Party Services</h2>
          <p>
            We use the following third-party services. When you use BYOK keys, API
            calls are made directly to these providers on your behalf.
          </p>
          <ul>
            <li>
              <strong>AI Providers</strong> (Anthropic, OpenAI): lesson script
              generation, Q&amp;A, lesson creation chat, content moderation
            </li>
            <li>
              <strong>Speech-to-Text</strong> (OpenAI Whisper): audio
              transcription for imported audio
            </li>
            <li>
              <strong>TTS Providers</strong> (ElevenLabs, OpenAI, Cartesia,
              Hume, Fal.ai, Replicate): audio generation
            </li>
            <li>
              <strong>Content Moderation</strong> (OpenAI Moderation API): automated
              safety checks on user-generated content
            </li>
            <li>
              <strong>Storage</strong> (Cloudflare R2): audio files, transcripts,
              and user avatars
            </li>
            <li>
              <strong>Authentication</strong> (Google, GitHub, Apple, Twitter/X): OAuth sign-in
            </li>
          </ul>
          <p>
            Each third-party service has its own privacy policy governing how they
            handle data sent to them.
          </p>

          <h2>6. AI-Generated Content</h2>
          <p>
            Sotto generates lesson content using AI. All AI-generated lessons are
            labeled as such. Imported human-created content is labeled accordingly.
            Sotto does not claim ownership of AI-generated content. You retain rights
            to the lessons you create.
          </p>

          <h2>7. Data Storage, Security, and Retention</h2>
          <ul>
            <li>Data is stored on servers hosted in the EU (Hetzner, Germany)</li>
            <li>BYOK keys are encrypted with AES-256-GCM at rest</li>
            <li>All connections use HTTPS/TLS</li>
            <li>Database access is restricted to application services only</li>
            <li>Session tokens use secure, HttpOnly cookies</li>
          </ul>
          <h3>Retention Periods</h3>
          <ul>
            <li>
              <strong>Account data</strong>: retained until you delete your account
            </li>
            <li>
              <strong>Behavioral data</strong>: associated with your account while
              active; anonymized upon account deletion
            </li>
            <li>
              <strong>API usage logs</strong>: user association removed (set to null)
              upon account deletion; aggregated logs retained for cost tracking
            </li>
            <li>
              <strong>Audio files</strong>: deleted from storage upon account deletion
            </li>
          </ul>

          <h2>8. Your Rights</h2>
          <p>
            Under the GDPR and similar data protection laws, you have the following
            rights:
          </p>
          <ul>
            <li>
              <strong>Access</strong>: request a copy of all personal data we hold
              about you
            </li>
            <li>
              <strong>Rectification</strong>: correct inaccurate personal data via
              your profile settings
            </li>
            <li>
              <strong>Erasure</strong>: delete your account and all associated data
            </li>
            <li>
              <strong>Portability</strong>: export your data in a machine-readable
              JSON format
            </li>
            <li>
              <strong>Restriction</strong>: request that we limit processing of your
              data
            </li>
            <li>
              <strong>Objection</strong>: object to processing based on legitimate
              interest
            </li>
          </ul>

          <h3>Account Deletion</h3>
          <p>
            You can delete your account at any time from your profile settings. This
            permanently removes your profile, lessons, scripts, interactions,
            and all associated content. Audio files are deleted from storage. Data in
            models without a direct foreign key, such as feedback, is explicitly deleted
            before your account is removed.
          </p>

          <h3>Data Export</h3>
          <p>
            You can export all your data at any time from your account settings or by
            calling <code>GET /api/v1/users/me/export</code>. The export includes your
            profile, lessons, scripts, discovery conversations, interactions,
            saves, ratings, feedback, taste quiz answers, and saved ideas, all in a
            single JSON file.
          </p>

          <h3>BYOK Key Removal</h3>
          <p>
            You can remove your API keys at any time from the API key settings page.
            Removed keys are immediately deleted from our encrypted storage.
          </p>

          <h2>9. International Data Transfers</h2>
          <p>
            Our primary infrastructure is hosted in the EU (Hetzner, Germany). When
            you use BYOK keys, API calls may be routed to providers based in the
            United States (Anthropic, OpenAI, ElevenLabs, and others). These
            transfers are initiated by your use of your own API keys.
          </p>

          <h2>10. Cookies</h2>
          <p>
            We use essential cookies for authentication (session tokens) only. We do
            not use third-party tracking cookies, advertising cookies, or analytics
            cookies. No cookie consent banner is required as we only use strictly
            necessary cookies.
          </p>

          <h2>11. Children</h2>
          <p>
            Sotto is not intended for children under 13. We do not knowingly collect
            data from children under 13. If we learn that we have collected data from
            a child under 13, we will delete it promptly.
          </p>

          <h2>12. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Significant changes will be
            communicated via in-app notification. Continued use of the service after
            changes constitutes acceptance of the updated policy.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions about this policy or to exercise your data rights? Email us
            at{' '}
            <a href="mailto:support@example.com">support@example.com</a>.
          </p>
        </div>
      </div>
    </main>
      <Footer />
    </>
  );
}
