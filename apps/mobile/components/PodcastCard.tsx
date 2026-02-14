import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { Avatar } from './Avatar';
import { formatDuration, formatCount, timeAgo, formatDurationMinutes } from '../lib/formatters';

interface PodcastCardFeedProps {
  podcast: PodcastSummary;
  variant: 'feed';
  onPress: () => void;
}

interface PodcastCardCompactProps {
  podcast: PodcastSummary;
  variant: 'compact';
  onPress: () => void;
}

type PodcastCardProps = PodcastCardFeedProps | PodcastCardCompactProps;

export function PodcastCard({ podcast, variant, onPress }: PodcastCardProps) {
  if (variant === 'compact') {
    return <CompactCard podcast={podcast} onPress={onPress} />;
  }

  return <FeedCard podcast={podcast} onPress={onPress} />;
}

function FeedCard({
  podcast,
  onPress,
}: {
  podcast: PodcastSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.feedCard, pressed && styles.feedCardPressed]}
      onPress={onPress}
    >
      <View style={styles.feedHeader}>
        <Avatar
          uri={podcast.user.image}
          name={podcast.user.name}
          size={36}
        />
        <View style={styles.feedHeaderText}>
          <Text style={styles.creatorName} numberOfLines={1}>
            {podcast.user.name ?? 'Unknown'}
          </Text>
          {podcast.user.handle ? (
            <Text style={styles.creatorHandle} numberOfLines={1}>
              @{podcast.user.handle}
            </Text>
          ) : null}
        </View>
        <Text style={styles.timeAgo}>{timeAgo(podcast.createdAt)}</Text>
      </View>

      <Text style={styles.feedTitle} numberOfLines={2}>
        {podcast.title}
      </Text>
      <Text style={styles.feedTopic} numberOfLines={1}>
        {podcast.topic}
      </Text>

      {podcast.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {podcast.tags.slice(0, 3).map((tag) => (
            <View key={tag.id} style={styles.tag}>
              <Text style={styles.tagText}>{tag.name}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.feedFooter}>
        <View style={styles.statRow}>
          <Text style={styles.statIcon}>&#9654;</Text>
          <Text style={styles.statText}>{formatCount(podcast.playCount)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statIcon}>&#9825;</Text>
          <Text style={styles.statText}>{formatCount(podcast.likeCount)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statIcon}>&#8631;</Text>
          <Text style={styles.statText}>{formatCount(podcast.forkCount)}</Text>
        </View>
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>
            {formatDuration(podcast.duration)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function CompactCard({
  podcast,
  onPress,
}: {
  podcast: PodcastSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.compactCard}
      accessibilityLabel={`${podcast.title} by ${podcast.user?.name ?? 'Unknown'}`}
      accessibilityRole="button"
    >
      <View style={styles.compactContent}>
        <Text style={styles.compactTitle} numberOfLines={2}>
          {podcast.title}
        </Text>
        <Text style={styles.compactTopic} numberOfLines={1}>
          {podcast.topic}
        </Text>
        <View style={styles.compactMeta}>
          {podcast.duration !== null && (
            <Text style={styles.compactMetaText}>
              {formatDurationMinutes(podcast.duration)}
            </Text>
          )}
          <Text style={styles.compactMetaDot}>{'\u00B7'}</Text>
          <Text style={styles.compactMetaText}>
            {podcast.likeCount} {podcast.likeCount === 1 ? 'like' : 'likes'}
          </Text>
          {podcast.status !== 'READY' && (
            <>
              <Text style={styles.compactMetaDot}>{'\u00B7'}</Text>
              <Text style={styles.compactStatusText}>{podcast.status}</Text>
            </>
          )}
        </View>
      </View>
      <Text style={styles.chevron}>{'\u203A'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Feed variant
  feedCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  feedCardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm + 4,
  },
  feedHeaderText: {
    flex: 1,
    marginLeft: spacing.sm + 2,
  },
  creatorName: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  creatorHandle: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  timeAgo: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  feedTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: 4,
    lineHeight: 26,
  },
  feedTopic: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
    marginBottom: spacing.sm + 4,
  },
  tag: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primaryLighter,
  },
  tagText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '500',
    color: colors.primaryHover,
  },
  feedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statIcon: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  statText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
  },
  durationBadge: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accentSubtle,
  },
  durationText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '500',
    color: colors.accent,
  },

  // Compact variant
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  compactTitle: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  compactTopic: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  compactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  compactMetaText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  compactMetaDot: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  compactStatusText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.warning,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 24,
    color: colors.textTertiary,
  },
});
