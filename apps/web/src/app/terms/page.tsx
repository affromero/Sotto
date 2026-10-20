import { PublicNav } from '@/components/layout/PublicNav';
import { Footer } from '@/components/layout/Footer';
import styles from './page.module.css';

export const metadata = {
  title: 'Terms. Sotto',
  description: 'Terms for the Sotto source-available software and self-hosted instances.',
};

export default function TermsPage() {
  return (
    <>
      <PublicNav />
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>Terms</h1>
            <p className={styles.subtitle}>Terms for source-available, self-hosted Sotto.</p>
            <p className={styles.lastUpdated}>
              The repository license for your version governs use.
            </p>
          </header>

          <div className={styles.content}>
            <h2>1. Source-available software</h2>
            <p>
              Sotto&apos;s first-party application is provided under PolyForm Noncommercial 1.0.0,
              subject to the component exceptions in THIRD_PARTY_NOTICES.md. The license permits its
              stated noncommercial, personal and institutional uses. Other commercial use requires
              separate permission from the rights holders. The repository license governs use,
              copying, modification and distribution.
            </p>

            <h2>2. Self-hosted instances</h2>
            <p>
              Each Sotto deployment is operated independently. The instance operator, not the
              source-available project, is responsible for availability, user access, data handling,
              provider accounts, generated content, backups, moderation, and compliance with
              applicable law. An operator may publish additional terms for their instance.
            </p>

            <h2>3. AI-generated output</h2>
            <p>
              Lessons, citations, translations, grading, and other output may be generated or
              evaluated by automated systems and can be inaccurate. Citation checks reduce risk but
              do not replace review of primary sources. Do not rely on Sotto for medical, legal,
              financial, safety-critical, or other professional decisions.
            </p>

            <h2>4. Source material and provider terms</h2>
            <p>
              Users and operators must have the right to process source material they submit and
              must follow the terms of configured AI, speech, search, and storage providers.
            </p>

            <h2>5. Security</h2>
            <p>
              Operators must protect credentials, keep dependencies current, configure HTTPS and the
              instance access password for network exposure, and restrict access to the host,
              database, storage, and backups. Security vulnerabilities in the software should be
              reported through the process in SECURITY.md.
            </p>

            <h2>6. No warranty</h2>
            <p>
              The software is provided without warranty, as described in the applicable component
              license. To the extent permitted by law, contributors are not liable for losses
              arising from operating or using an independently deployed instance.
            </p>

            <h2>7. Questions</h2>
            <p>
              Contact the operator for questions about a particular deployment. Use the
              repository&apos;s public support channels for questions about the software.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
