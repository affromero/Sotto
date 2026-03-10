import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius, getContentBadgeLabel } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { Avatar } from './Avatar';
import { getPodcastGradient } from '../lib/gradients';
import { shadowLg, shadowSm } from '../lib/shadows';
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
  const gradient = getPodcastGradient(podcast.id);

  return (
    <Pressable
      style={({ pressed }) => [styles.feedCard, pressed && styles.feedCardPressed]}
      onPress={onPress}
    >
      <LinearGradient
        colors={gradient.colors}
        start={gradient.start}
        end={gradient.end}
        style={styles.feedGradient}
      >
        {/* Bottom scrim for text readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.45)']}
          style={styles.feedScrim}
        />

        {/* Top row: avatar + badges */}
        <View style={styles.feedHeader}>
          <Avatar
            uri={podcast.user.image}
            name={podcast.user.name}
            size={32}
          />
          <View style={styles.feedHeaderText}>
            <Text style={styles.creatorName} numberOfLines={1}>
              {podcast.user.name ?? 'Unknown'}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.contentBadge}>
              <Text style={styles.contentBadgeText}>
                {getContentBadgeLabel(podcast)}
              </Text>
            </View>
            <Text style={styles.timeAgo}>{timeAgo(podcast.createdAt)}</Text>
          </View>
        </View>

        {/* Bottom content over scrim */}
        <View style={styles.feedBottom}>
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
              <Ionicons name="play" size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.statText}>{formatCount(podcast.playCount)}</Text>
            </View>
            <View style={styles.statRow}>
              <Ionicons name="heart-outline" size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.statText}>{formatCount(podcast.likeCount)}</Text>
            </View>
            <View style={styles.statRow}>
              <Ionicons name="git-branch-outline" size={13} color="rgba(255,255,255,0.7)" />
              <Text style={styles.statText}>{formatCount(podcast.forkCount)}</Text>
            </View>
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>
                {formatDuration(podcast.duration)}
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
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
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Feed variant — gradient cover card
  feedCard: {
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadowLg,
  },
  feedCardPressed: {
    opacity: 0.92,
  },
  feedGradient: {
    minHeight: 180,
    justifyContent: 'space-between',
  },
  feedScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '70%',
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  feedHeaderText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  creatorName: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  contentBadge: {
    paddingHorizontal: spacing.xs + 4,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  contentBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  timeAgo: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  feedBottom: {
    padding: spacing.md,
    zIndex: 1,
  },
  feedTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 4,
    lineHeight: 26,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  feedTopic: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
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
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  tagText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '500',
    color: '#FFFFFF',
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
  statText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
  },
  durationBadge: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  durationText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  // Compact variant
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    ...shadowSm,
    marginBottom: 1,
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
});
