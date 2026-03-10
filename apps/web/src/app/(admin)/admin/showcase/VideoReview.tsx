'use client';

import styles from './VideoReview.module.css';

interface DemoProject {
  id: string;
  podcastId: string | null;
}

export function VideoReview({ project }: { project: DemoProject }) {
  // Video segment review will be populated when the podcast video pipeline is integrated.
  // For now, show a placeholder that explains the workflow.

  if (!project.podcastId) {
    return (
      <div className={styles.root}>
        <p className={styles.locked}>Link a podcast first (Step 2) to review video segments.</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Video Segments</h3>
      <p className={styles.description}>
        Once the podcast script is ready, classify segments into visual types,
        review AI prompts, and generate visuals per segment.
      </p>
      <p className={styles.placeholder}>
        Video segment review will populate automatically from the podcast video pipeline.
      </p>
    </div>
  );
}
