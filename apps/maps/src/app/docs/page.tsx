import styles from './page.module.css';

export default function DocsPage() {
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Developer Docs</h1>
      <p className={styles.subtitle}>Getting started with @sotto/maps</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Installation</h2>
        <pre className={styles.code}>{`import { MapView, PlaceResolver, SequenceBuilder } from '@sotto/maps';`}</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Basic Map</h2>
        <pre className={styles.code}>{`<MapView
  center={[28.97, 41.01]}
  zoom={12}
  preset="vintage"
  mapboxToken={token}
/>`}</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Place Resolution</h2>
        <pre className={styles.code}>{`const resolver = new PlaceResolver();
const place = await resolver.resolve('Constantinople');
// { name: 'Constantinople', coordinates: [28.97, 41.01], ... }

const historical = await resolver.resolveHistorical('Byzantium', 330, 1453);
// Biased toward WHG + Pleiades for historical queries`}</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Cinematic Sequences</h2>
        <pre className={styles.code}>{`const sequence = SequenceBuilder.cinematic(
  [rome, constantinople, jerusalem],
  5000 // ms per place
);

<MapSequence
  sequence={sequence}
  preset="cinematic"
  mapboxToken={token}
  autoPlay
/>`}</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Historical Comparison</h2>
        <pre className={styles.code}>{`<DualEraView
  place={constantinople}
  mode="slider"
  modernPreset="satellite"
  historicalPreset="vintage"
  mapboxToken={token}
/>`}</pre>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Available Presets</h2>
        <pre className={styles.code}>{`vintage    — Antique paper + sepia tones
satellite  — Modern satellite imagery
parchment  — Old-world parchment feel
cinematic  — Dramatic 3D terrain
dark       — Dark mode map
terrain    — Topographic with hillshading`}</pre>
      </section>
    </div>
  );
}
