import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Privacy. Sotto',
  description: 'Privacy information for self-hosted Sotto instances.',
};

export default function PrivacyPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>Privacy</h1>
            <p className={styles.subtitle}>How data flows through a self-hosted Sotto instance.</p>
            <p className={styles.lastUpdated}>Last updated: July 19, 2026</p>
          </header>

          <div className={styles.content}>
            <h2>1. The instance operator controls your data</h2>
            <p>
              Sotto is self-hosted software. The person or organization operating this instance
              controls its database, files, configuration, backups, logs, and network access. The
              Sotto open-source project does not receive data from independently operated instances.
            </p>

            <h2>2. Data stored by an instance</h2>
            <p>
              An instance may store household profiles, courses, generated lessons, source material,
              scripts, recordings, transcripts, answers, feedback, progress, provider usage records,
              and encrypted provider credentials. The exact data depends on the features the
              operator enables.
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
              Provider keys stored by Sotto are encrypted at rest with the instance&apos;s
              encryption key. Internet-facing instances should use the shared access password,
              HTTPS, firewalling, current software versions, and restricted administrative access.
              Security also depends on how the operator protects the host, database, backups, and
              encryption keys.
            </p>

            <h2>5. Retention, deletion, and export</h2>
            <p>
              Sotto includes controls for deleting profiles and associated application data.
              Operators remain responsible for retention in backups, external storage, logs, and
              connected providers. Ask the operator of this instance about access, correction,
              export, deletion, or retention requests.
            </p>

            <h2>6. Cookies</h2>
            <p>
              Sotto uses essential cookies for the instance access gate and active household
              profile. The open-source application does not include advertising cookies. An operator
              may add a reverse proxy, monitoring, or other services with separate cookie or logging
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
              open-source software, use the project&apos;s public security and support channels.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
