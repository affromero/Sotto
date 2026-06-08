import Link from 'next/link';
import { NEWS_CATEGORY_LABELS } from '@sotto/shared';
import { podcastUrl } from '@/lib/urls';
import type { NewsArticle, NewsCategory } from '@/types/news';
import styles from './NewsCard.module.css';

interface NewsCardProps {
  article: NewsArticle;
  isAuthenticated: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function NewsCard({ article, isAuthenticated }: NewsCardProps) {
  const categoryLabel = article.category
    ? (NEWS_CATEGORY_LABELS[article.category as NewsCategory] ?? article.category)
    : null;

  const createUrl = `/create?topic=${encodeURIComponent(article.title)}`;
  const generateHref = isAuthenticated
    ? createUrl
    : `/auth/login?callbackUrl=${encodeURIComponent(createUrl)}`;

  const briefingHref = article.relatedPodcastId
    ? podcastUrl({ id: article.relatedPodcastId })
    : null;

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.sourceBadge}>{article.source}</span>
        {categoryLabel && <span className={styles.categoryBadge}>{categoryLabel}</span>}
        {article.pubDate && (
          <time className={styles.time} dateTime={article.pubDate}>
            {formatRelativeTime(article.pubDate)}
          </time>
        )}
      </div>

      <h3 className={styles.title}>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {article.title}
        </a>
      </h3>

      {article.summary && <p className={styles.summary}>{article.summary}</p>}

      <div className={styles.actions}>
        <Link href={generateHref} className={styles.generateBtn}>
          Generate Podcast
        </Link>
        {briefingHref && (
          <Link href={briefingHref} className={styles.relatedLink}>
            Listen to Briefing
          </Link>
        )}
      </div>
    </article>
  );
}
