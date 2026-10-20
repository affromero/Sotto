import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import { privacyContactUrl } from '@/lib/privacy/contact';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Privacy. Sotto',
  description: 'Privacy information for self-hosted Sotto instances.',
};

export default function PrivacyPage() {
  const contact = privacyContactUrl(process.env.SOTTO_PRIVACY_CONTACT_EMAIL);
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>Privacy</h1>
            <p className={styles.subtitle}>How data flows through a self-hosted Sotto instance.</p>
            <p className={styles.lastUpdated}>Last updated: October 21, 2026</p>
          </header>

          <div className={styles.content}>
            <h2>1. The instance operator controls your data</h2>
            <p>
              Sotto is self-hosted software. The person or organization operating this instance
              controls its database, files, configuration, backups, logs, and network access. The
              Sotto source-available project does not receive data from independently operated
              instances.
            </p>

            <h2>2. Data stored by an instance</h2>
            <p>
              An instance may store profiles, courses, generated lessons, source material, scripts,
              recordings, transcripts, answers, feedback, progress, provider usage records, and game
              answers, partner messages, private phrase notebooks and encrypted provider
              credentials. The exact data depends on the features the operator enables.
            </p>

            <h2>3. Configured service providers</h2>
            <p>
              Lesson content, source material, prompts, recordings, or transcripts may be sent to
              the AI, speech-to-text, text-to-speech, search, monitoring, and storage providers
              configured by the operator. Local providers can keep processing on operator-owned
              infrastructure; cloud providers process data under their own terms and privacy
              policies. Review the instance configuration before entering sensitive information.
            </p>

            <h2>4. Credentials and access</h2>
            <p>
              The iPhone and iPad app stores pairing credentials in the device Keychain and scans
              pairing QR codes locally. Handwriting and workbook annotations are saved on the
              device. Handwriting recognition runs on the device; you can review and edit the
              recognized text before submitting it to your server for feedback. Photos you choose
              for your profile are uploaded to your server. The app includes no advertising or
              tracking SDKs.
            </p>
            <p>
              The Android app encrypts saved credentials, invitation recovery, drafts and pending
              actions with Android Keystore protection and excludes them from device backups.
              Pairing and invitation QR codes are scanned locally after camera permission. Partner
              games run without AI requests. Your partner sees content revealed by the game; your
              phrase notebook stays private. Add to study explicitly saves phrases to your
              profile&apos;s learning tools.
            </p>
            <p>
              Live translation asks for permission before streaming microphone audio and translation
              context directly to Google Gemini. The conversation transcript is saved on your
              server. Review{' '}
              <a href="https://policies.google.com/privacy">Google&apos;s privacy policy</a> before
              using live translation. You can end a live session at any time. Unpair the device to
              stop using the connected server; unpairing removes access credentials but does not
              delete learning data.
            </p>
            <p>
              Provider keys stored by Sotto are encrypted at rest with the instance&apos;s
              encryption key. Internet-facing instances should use the shared access password,
              HTTPS, firewalling, current software versions, and restricted administrative access.
              Security also depends on how the operator protects the host, database, backups, and
              encryption keys.
            </p>

            <h2 id="delete-profile">5. Retention, deletion, and export</h2>
            <p>
              Sotto includes controls for deleting profiles and associated application data. In the
              iPhone and iPad app, use Delete learner profile in Settings. In the Android app, open
              Saved connections and recoveries, then Delete learner profile. Confirm the named
              profile and server. Operators remain responsible for retention in backups, external
              storage, logs, and connected providers. Ask the operator of this instance about
              access, correction, export, deletion, or retention requests.
            </p>
            <p>
              You can request deletion without installing Sotto. Contact the operator of the server
              where your profile lives and identify that server and your profile name. Send no
              passwords, device tokens or invitation proofs. The operator may need to verify profile
              ownership before arranging deletion. Independently operated servers control their own
              deletion and retention.
            </p>
            {contact && (
              <p>
                <a href={contact}>
                  Request Sotto profile deletion from this server&apos;s operator
                </a>
                .
              </p>
            )}

            <h2>6. Cookies</h2>
            <p>
              Sotto uses essential cookies for the app password and active profile. The
              source-available application does not include advertising cookies. An operator may add
              a reverse proxy, monitoring, or other services with separate cookie or logging
              behavior.
            </p>

            <h2>7. Children and regulated use</h2>
            <p>
              Instance operators are responsible for deciding who may use their deployment,
              obtaining any required consent, and complying with laws that apply to their users and
              jurisdiction.
            </p>

            <h2>8. Questions</h2>
            <p>
              Contact the operator of this instance for privacy requests. For issues in the
              source-available software, use the project&apos;s public security and support
              channels.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
