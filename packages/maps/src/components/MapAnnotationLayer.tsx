import type { MapAnnotation } from '../types';
import styles from './MapAnnotationLayer.module.css';

interface MapAnnotationLayerProps {
  annotations: MapAnnotation[];
  className?: string;
}

export function MapAnnotationLayer({ annotations, className }: MapAnnotationLayerProps) {
  if (!annotations.length) return null;

  return (
    <div className={`${styles.root} ${className ?? ''}`}>
      {annotations.map((annotation, i) => (
        <div
          key={`${annotation.coordinates[0]}-${annotation.coordinates[1]}-${i}`}
          className={`${styles.annotation} ${styles[annotation.style]}`}
        >
          <span className={styles.text}>{annotation.text}</span>
        </div>
      ))}
    </div>
  );
}
