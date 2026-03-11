import { ScrollChapter } from '../ScrollChapter';
import styles from './ShowcaseChapter.module.css';

const SEGMENTS = [
  { num: 1, label: 'CRISPR molecular scissors', type: 'AI Illustration', colorClass: 'purple' },
  { num: 2, label: 'Gene therapy success rates', type: 'Data Chart', colorClass: 'amber' },
  { num: 3, label: 'Laboratory research setting', type: 'Stock Footage', colorClass: 'navy' },
  { num: 4, label: 'Key milestones in gene editing', type: 'Timeline', colorClass: 'green' },
] as const;

const COLOR_MAP = {
  purple: styles.badgePurple,
  amber: styles.badgeAmber,
  navy: styles.badgeNavy,
  green: styles.badgeGreen,
} as Record<string, string>;

export function ShowcaseChapter() {
  return (
    <ScrollChapter id="video">
      <div className={styles.root}>
        <div className={`${styles.split} ${styles.splitReverse}`} data-reveal>
          <div className={styles.splitVisual}>
            <div className={styles.mockVideo}>
              <div className={styles.mockHeader}>
                <div className={styles.mockDot} aria-hidden="true" />
                <span>Video Pipeline</span>
              </div>
              <div className={styles.mockBody}>
                {SEGMENTS.map((seg) => (
                  <div key={seg.num} className={styles.segment}>
                    <span className={styles.segNum}>{seg.num}</span>
                    <span className={styles.segLabel}>{seg.label}</span>
                    <span className={`${styles.segBadge} ${COLOR_MAP[seg.colorClass]}`}>
                      {seg.type}
                    </span>
                  </div>
                ))}
                <div className={styles.videoFooter}>
                  <span className={styles.toggle}>
                    <span className={styles.toggleTrack}>
                      <span className={styles.toggleKnob} />
                    </span>
                    Avatars: On
                  </span>
                  <span className={styles.videoCount}>9 visual types</span>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.splitText}>
            <div className={styles.textContent}>
              <span className={styles.overline}>Video generation</span>
              <h2 className={styles.heading}>Turn podcasts into video</h2>
              <p className={styles.description}>
                Every segment gets a visual &mdash; AI illustrations, data charts,
                stock footage, or timeline graphics. Add avatar presenters or keep
                it clean. 9 visual types, fully automatic.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ScrollChapter>
  );
}
