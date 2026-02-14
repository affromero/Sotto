import { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../../lib/api';
import { globalStyles } from '../../lib/theme';
import { formatCount } from '../../lib/formatters';
import { Avatar } from '../../components/Avatar';
import { PodcastCard } from '../../components/PodcastCard';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';

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
      <View style={globalStyles.screenContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <ErrorState message="This user may not exist or the page could not be loaded." />
      </View>
    );
  }

  const displayName = user.name ?? 'Anonymous';

  return (
    <View style={globalStyles.screenContainer}>
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
            <View style={styles.avatarContainer}>
              <Avatar uri={user.image} name={displayName} size={88} />
            </View>

            <Text style={styles.name}>{displayName}</Text>
            {user.handle ? (
              <Text style={styles.handle}>@{user.handle}</Text>
            ) : null}
            {user.bio ? (
              <Text style={styles.bio}>{user.bio}</Text>
            ) : null}

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

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Podcasts</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <PodcastCard
            podcast={item}
            variant="compact"
            onPress={() => handleNavigateToPodcast(item.id)}
          />
        )}
        ListEmptyComponent={
          podcastsLoading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <EmptyState title="No podcasts yet" />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
  listContent: {
    paddingBottom: spacing.xl,
  },
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  avatarContainer: {
    marginBottom: spacing.md,
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
  emptyContainer: {
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
  },
});
