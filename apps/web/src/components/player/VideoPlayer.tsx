import styles from './VideoPlayer.module.css';

interface VideoPlayerProps {
  videoUrl: string;
  title?: string;
}

export function VideoPlayer({ videoUrl, title }: VideoPlayerProps) {
  return (
    <div className={styles.root}>
      <video
        className={styles.video}
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        aria-label={title ? `Video: ${title}` : 'Video player'}
      />
    </div>
  );
}
