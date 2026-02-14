import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../../lib/api';

interface UserProfile {
  id: string;
  name: string | null;
  handle: string | null;
  bio: string | null;
  image: string | null;
  podcastCount: number;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
}

function formatCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  return `${mins} min`;
}

function PodcastCard({
  podcast,
  onPress,
}: {
  podcast: PodcastSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.podcastCard}
      accessibilityLabel={`${podcast.title} by ${podcast.user?.name ?? 'Unknown'}`}
      accessibilityRole="button"
    >
      <View style={styles.podcastCardContent}>
        <Text style={styles.podcastTitle} numberOfLines={2}>
          {podcast.title}
        </Text>
        <Text style={styles.podcastTopic} numberOfLines={1}>
          {podcast.topic}
        </Text>
        <View style={styles.podcastMeta}>
          {podcast.duration !== null && (
            <Text style={styles.podcastMetaText}>
              {formatDuration(podcast.duration)}
            </Text>
          )}
          <Text style={styles.podcastMetaDot}>{'\u00B7'}</Text>
          <Text style={styles.podcastMetaText}>
            {podcast.likeCount} {podcast.likeCount === 1 ? 'like' : 'likes'}
          </Text>
          {podcast.status !== 'READY' && (
            <>
              <Text style={styles.podcastMetaDot}>{'\u00B7'}</Text>
              <Text style={styles.podcastStatusText}>{podcast.status}</Text>
            </>
          )}
        </View>
      </View>
      <Text style={styles.chevron}>{'\u203A'}</Text>
    </Pressable>
  );
}

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const queryClient = useQueryClient();

  const {
    data: user,
    isLoading: userLoading,
    error: userError,
  } = useQuery<UserProfile>({
    queryKey: ['user', userId],
    queryFn: async () => {
      const res = await api.get(`/users/${userId}`);
      return res.data;
    },
    enabled: !!userId,
  });

  const {
    data: podcasts,
    isLoading: podcastsLoading,
  } = useQuery<PodcastSummary[]>({
    queryKey: ['user-podcasts', userId],
    queryFn: async () => {
      const res = await api.get(`/users/${userId}/podcasts`);
      return res.data?.podcasts ?? res.data ?? [];
    },
    enabled: !!userId,
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      if (user?.isFollowing) {
        await api.delete(`/users/${userId}/follow`);
      } else {
        await api.post(`/users/${userId}/follow`);
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['user', userId] });
      const previous = queryClient.getQueryData<UserProfile>(['user', userId]);
      if (previous) {
        queryClient.setQueryData<UserProfile>(['user', userId], {
          ...previous,
          isFollowing: !previous.isFollowing,
          followerCount: previous.isFollowing
            ? previous.followerCount - 1
            : previous.followerCount + 1,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['user', userId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
    },
  });

  const handleNavigateToPodcast = useCallback((podcastId: string) => {
    router.push(`/podcast/${podcastId}`);
  }, []);

  if (userLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  if (userError || !user) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>Profile not found</Text>
        <Text style={styles.errorSubtext}>
          This user may not exist or the page could not be loaded.
        </Text>
      </View>
    );
  }

  const displayName = user.name ?? 'Anonymous';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />

      <FlatList<PodcastSummary>
        data={podcasts ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.profileSection}>
            {/* Avatar */}
            <View style={styles.avatarContainer}>
              {user.image ? (
                <Image
                  source={{ uri: user.image }}
                  style={styles.avatar}
                  accessibilityLabel={`${displayName}'s avatar`}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>
                    {displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            {/* Name + Handle */}
            <Text style={styles.name}>{displayName}</Text>
            {user.handle && (
              <Text style={styles.handle}>@{user.handle}</Text>
            )}

            {/* Bio */}
            {user.bio && (
              <Text style={styles.bio}>{user.bio}</Text>
            )}

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {formatCount(user.podcastCount)}
                </Text>
                <Text style={styles.statLabel}>Podcasts</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {formatCount(user.followerCount)}
                </Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  {formatCount(user.followingCount)}
                </Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
            </View>

            {/* Follow Button */}
            <Pressable
              onPress={() => followMutation.mutate()}
              style={[
                styles.followButton,
                user.isFollowing && styles.followButtonActive,
              ]}
              disabled={followMutation.isPending}
              accessibilityLabel={
                user.isFollowing ? 'Unfollow this user' : 'Follow this user'
              }
              accessibilityRole="button"
            >
              {followMutation.isPending ? (
                <ActivityIndicator
                  size="small"
                  color={
                    user.isFollowing ? colors.textSecondary : colors.textInverse
                  }
                />
              ) : (
                <Text
                  style={[
                    styles.followButtonText,
                    user.isFollowing && styles.followButtonTextActive,
                  ]}
                >
                  {user.isFollowing ? 'Following' : 'Follow'}
                </Text>
              )}
            </Pressable>

            {/* Podcasts Section Header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Podcasts</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <PodcastCard
            podcast={item}
            onPress={() => handleNavigateToPodcast(item.id)}
          />
        )}
        ListEmptyComponent={
          podcastsLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No podcasts yet</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorIcon: {
    fontFamily: typography.fontHeading,
    fontSize: 48,
    color: colors.error,
    width: 72,
    height: 72,
    lineHeight: 72,
    textAlign: 'center',
    backgroundColor: colors.errorLight,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  errorText: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  errorSubtext: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: spacing.xl,
  },

  // Profile Section
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  avatarContainer: {
    marginBottom: spacing.md,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.border,
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: typography.fontHeading,
    fontSize: 36,
    color: colors.primary,
  },
  name: {
    fontFamily: typography.fontHeading,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  handle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  bio: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    width: '100%',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: typography.fontBody,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: colors.border,
  },

  // Follow
  followButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing['2xl'],
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    minWidth: 140,
    alignItems: 'center',
  },
  followButtonActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
  followButtonTextActive: {
    color: colors.textSecondary,
  },

  // Section Header
  sectionHeader: {
    width: '100%',
    marginTop: spacing.xl,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
  },

  // Podcast Card
  podcastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  podcastCardContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  podcastTitle: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 22,
  },
  podcastTopic: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  podcastMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  podcastMetaText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  podcastMetaDot: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  podcastStatusText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.warning,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 24,
    color: colors.textTertiary,
  },

  // Empty state
  emptyContainer: {
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
  },
});
