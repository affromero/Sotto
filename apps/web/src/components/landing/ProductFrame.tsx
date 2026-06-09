import styles from './ProductFrame.module.css';

interface ProductFrameProps {
  /** Faint title or url shown in the chrome bar. */
  title: string;
  /** Mono caption rendered under the frame (for example "Placement, your level in minutes"). */
  caption: string;
  /** Chrome style: a browser window with a url pill, or a flat app titlebar. */
  chrome?: 'browser' | 'app';
  /** The CSS-built product mockup that fills the frame. */
  children: React.ReactNode;
}

/**
 * A static product "frame": browser or app chrome (a top bar with three dots and
 * a faint title or url) wrapping a CSS-built aula mockup, with a mono caption
 * beneath. Server-rendered and presentational only. Used by the landing
 * walkthrough so each step shows a faithful, on-brand picture of the real UI.
 */
export function ProductFrame({ title, caption, chrome = 'browser', children }: ProductFrameProps) {
  return (
    <figure className={styles.figure}>
      <div className={`${styles.frame} ${chrome === 'app' ? styles.frameApp : ''}`}>
        <div className={styles.bar}>
          <span className={styles.dots} aria-hidden="true">
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </span>
          <span className={styles.titlePill}>{title}</span>
        </div>
        <div className={styles.screen}>{children}</div>
      </div>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
