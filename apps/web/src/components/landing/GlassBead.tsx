import styles from './GlassBead.module.css';

interface GlassBeadProps {
  /** Optional extra class to size/position the bead from a parent module. */
  className?: string;
}

/**
 * The Sotto glass-bead mark — an animated liquid-glass orb that stands in for
 * the wordmark's dot. Size scales with the surrounding font-size (0.44em) so it
 * tracks the serif wordmark wherever it sits. Animations are transform/opacity
 * only and are disabled under prefers-reduced-motion (handled in CSS).
 */
export function GlassBead({ className }: GlassBeadProps) {
  return (
    <span className={`${styles.bead} ${className ?? ''}`.trim()} aria-hidden="true">
      <span className={styles.spec} />
      <span className={styles.glare} />
    </span>
  );
}
