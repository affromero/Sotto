import styles from './GlassOrb.module.css';

interface GlassOrbProps {
  /** Diameter in px. Drives the wrapper font-size so shadows/offsets scale. */
  size?: number;
  className?: string;
}

/**
 * The larger, animated Sotto glass mark — a liquid-glass orb that floats, breathes,
 * casts a contact reflection, and catches a slow glare sweep. Same cool-blue→warm-pink
 * identity as {@link GlassBead}, sized for hero/loading moments rather than the wordmark
 * dot. All animation is transform/opacity and respects prefers-reduced-motion.
 */
export function GlassOrb({ size = 120, className }: GlassOrbProps) {
  return (
    <span
      className={`${styles.wrap} ${className ?? ''}`.trim()}
      style={{ fontSize: size }}
      aria-hidden="true"
    >
      <span className={styles.orb}>
        <span className={styles.glare} />
        <span className={styles.spec} />
      </span>
    </span>
  );
}
