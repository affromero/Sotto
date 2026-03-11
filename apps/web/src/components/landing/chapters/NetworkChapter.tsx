import { ScrollChapter } from '../ScrollChapter';
import { PoweredByProviders } from '../PoweredByProviders';
import styles from './NetworkChapter.module.css';

const FEATURES = [
  {
    title: 'Fork & Remix',
    description:
      'Found a podcast you love? Fork it. Change the angle, swap voices, go deeper on a subtopic. Credit always links back to the original.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="7" cy="5" r="3" />
        <circle cx="7" cy="19" r="3" />
        <circle cx="19" cy="12" r="3" />
        <path d="M7 8v8M10 19h6a3 3 0 0 0 0-6h-6" />
      </svg>
    ),
  },
  {
    title: 'Import Any Podcast',
    description:
      'Bring podcasts from NotebookLM, Spotify, Apple Podcasts, YouTube, or any audio file. Sotto adds transcripts, social features, and interactive Q&A.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    title: 'Ask Questions Live',
    description:
      "Pause mid-playback to ask a follow-up. Get an answer drawn from the full context. Your Q&A gets woven back into the episode permanently.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    featured: true,
  },
];

const USE_CASES = [
  {
    title: 'Students',
    description: 'Turn dense research papers into digestible conversations. Study smarter by listening and asking questions in real time.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    title: 'Professionals',
    description: 'Stay current on industry trends during your commute. Get up to speed on any subject in 10 focused minutes.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    title: 'Educators',
    description: 'Create engaging supplementary material for your students. Interactive audio that adapts to every learner.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: 'Researchers',
    description: 'Make your work accessible to a wider audience. Transform complex findings into compelling conversations anyone can follow.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
];

export function NetworkChapter() {
  return (
    <ScrollChapter id="voices" alt>
      <div className={styles.root}>
        <div className={styles.header} data-reveal>
          <span className={styles.overline}>Community</span>
          <h2 className={styles.heading}>Fork, import, remix</h2>
          <p className={styles.description}>
            Sotto is a social podcast network. Build on what others started, bring in
            podcasts from anywhere, and interact with every episode.
          </p>
        </div>

        {/* Magazine grid — featured card spans 2 rows */}
        <div className={styles.cards}>
          {FEATURES.map((feature, i) => (
            <article
              key={feature.title}
              className={`${styles.card} ${feature.featured ? styles.cardFeatured : ''}`}
              data-reveal
              style={{ '--reveal-index': i } as React.CSSProperties}
            >
              <div className={`${styles.cardIcon} ${i === 1 ? styles.cardIconNavy : ''}`}>
                {feature.icon}
              </div>
              <h3 className={styles.cardTitle}>{feature.title}</h3>
              <p className={styles.cardDesc}>{feature.description}</p>
              {feature.featured && (
                <div className={styles.featuredMock}>
                  <div className={styles.mockQ}>
                    <span className={styles.mockQLabel}>Q:</span>
                    <span>How accurate is CRISPR currently?</span>
                  </div>
                  <div className={styles.mockA}>
                    <span className={styles.mockALabel}>A:</span>
                    <span>Recent studies show 90%+ on-target efficiency in human cells...</span>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>

        {/* Use cases grid */}
        <div className={styles.useCasesHeader} data-reveal>
          <h3 className={styles.useCasesTitle}>Built for everyone</h3>
        </div>
        <div className={styles.useCases}>
          {USE_CASES.map((uc, i) => (
            <article
              key={uc.title}
              className={styles.useCase}
              data-reveal
              style={{ '--reveal-index': i + 3 } as React.CSSProperties}
            >
              <div className={styles.useCaseIcon}>{uc.icon}</div>
              <h4 className={styles.useCaseTitle}>{uc.title}</h4>
              <p className={styles.useCaseDesc}>{uc.description}</p>
            </article>
          ))}
        </div>

        <div className={styles.providers} data-reveal>
          <PoweredByProviders />
        </div>
      </div>
    </ScrollChapter>
  );
}
