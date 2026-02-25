import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../../lib/api';
import { deleteToken } from '../../lib/auth';
import { globalStyles } from '../../lib/theme';
import { formatDuration, formatCount } from '../../lib/formatters';
import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';

interface UserProfile {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
  bio: string | null;
  podcastCount: number;
  followerCount: number;
  followingCount: number;
}

interface UserPodcastsResponse {
  podcasts: PodcastSummary[];
}

function StatusBadge({ status }: { status: string }) {
  const isReady = status === 'READY';
  const isPending =
    status === 'PENDING' ||
    status === 'DISCOVERING' ||
    status === 'EXTRACTING' ||
    status === 'SCRIPTING' ||
    status === 'VERIFYING_SCRIPT' ||
    status === 'VALIDATING_REFERENCES' ||
    status === 'SCRIPT_READY' ||
    status === 'GENERATING_AUDIO' ||
    status === 'STITCHING';

  return (
    <View
      style={[
        styles.statusBadge,
        isReady && styles.statusBadgeReady,
        isPending && styles.statusBadgePending,
        !isReady && !isPending && styles.statusBadgeError,
      ]}
    >
      <Text
        style={[
          styles.statusBadgeText,
          isReady && styles.statusBadgeTextReady,
          isPending && styles.statusBadgeTextPending,
          !isReady && !isPending && styles.statusBadgeTextError,
        ]}
      >
        {status === 'READY'
          ? 'Published'
          : status === 'GENERATING_AUDIO'
            ? 'Generating'
            : status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}
      </Text>
    </View>
  );
}

function MyPodcastItem({
  podcast,
  onPress,
}: {
  podcast: PodcastSummary;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.podcastItem,
        pressed && styles.podcastItemPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.podcastItemContent}>
        <View style={styles.podcastItemHeader}>
          <Text style={styles.podcastItemTitle} numberOfLines={1}>
            {podcast.title}
          </Text>
          <StatusBadge status={podcast.status} />
        </View>
        <Text style={styles.podcastItemTopic} numberOfLines={1}>
          {podcast.topic}
        </Text>
        <View style={styles.podcastItemMeta}>
          <Text style={styles.podcastItemStat}>
            {'\u25B6'} {formatCount(podcast.playCount)}
          </Text>
          <Text style={styles.podcastItemStat}>
            {'\u2665'} {formatCount(podcast.likeCount)}
          </Text>
          <Text style={styles.podcastItemDuration}>
            {formatDuration(podcast.duration)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: profile,
    isLoading: isProfileLoading,
    isError: isProfileError,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery<UserProfile>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const response = await api.get<UserProfile>('/users/me');
      return response.data;
    },
  });

  const {
    data: podcastsData,
    isLoading: isPodcastsLoading,
    isError: isPodcastsError,
    refetch: refetchPodcasts,
    isRefetching,
  } = useQuery<UserPodcastsResponse>({
    queryKey: ['user', 'me', 'podcasts'],
    queryFn: async () => {
      const response =
        await api.get<UserPodcastsResponse>('/users/me/podcasts');
      return response.data;
    },
    enabled: !!profile,
  });

  const handleSettingsPress = useCallback(() => {
    router.push('/settings');
  }, [router]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await deleteToken();
          queryClient.clear();
          router.replace('/auth/login');
        },
      },
    ]);
  }, [queryClient, router]);

  const handleRefresh = useCallback(() => {
    refetchProfile();
    refetchPodcasts();
  }, [refetchProfile, refetchPodcasts]);

  const podcasts = podcastsData?.podcasts ?? [];
  const isLoading = isProfileLoading || isPodcastsLoading;

  const renderPodcastItem = useCallback(
    ({ item }: { item: PodcastSummary }) => (
      <MyPodcastItem
        podcast={item}
        onPress={() => router.push(`/podcast/${item.id}`)}
      />
    ),
    [router],
  );

  const keyExtractor = useCallback(
    (item: PodcastSummary) => item.id,
    [],
  );

  const profileHeader = (
    <View style={styles.profileSection}>
      <View style={styles.profileTopRow}>
        <Avatar uri={profile?.image} name={profile?.name} size={80} />
        <Pressable
          style={styles.settingsButton}
          onPress={handleSettingsPress}
          hitSlop={8}
        >
          <Text style={styles.settingsIcon}>{'\u2699'}</Text>
        </Pressable>
      </View>

      <Text style={styles.profileName}>
        {profile?.name ?? 'Anonymous'}
      </Text>
      {profile?.handle ? (
        <Text style={styles.profileHandle}>@{profile.handle}</Text>
      ) : null}
      {profile?.bio ? (
        <Text style={styles.profileBio}>{profile.bio}</Text>
      ) : null}

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>
            {formatCount(profile?.podcastCount ?? 0)}
          </Text>
          <Text style={styles.statLabel}>Podcasts</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>
            {formatCount(profile?.followerCount ?? 0)}
          </Text>
          <Text style={styles.statLabel}>Followers</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>
            {formatCount(profile?.followingCount ?? 0)}
          </Text>
          <Text style={styles.statLabel}>Following</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.savedIdeasRow,
          pressed && styles.savedIdeasRowPressed,
        ]}
        onPress={() => router.push('/ideas')}
      >
        <Text style={styles.savedIdeasIcon}>{'\uD83D\uDD16'}</Text>
        <Text style={styles.savedIdeasLabel}>Saved Ideas</Text>
        <Text style={styles.savedIdeasChevron}>{'\u203A'}</Text>
      </Pressable>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Podcasts</Text>
      </View>
    </View>
  );

  return (
    <View style={globalStyles.screenContainer}>
      <FlatList
        data={podcasts}
        renderItem={renderPodcastItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={profileHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          isLoading && !profile ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : isProfileError ? (
            <ErrorState
              message={
                profileError instanceof Error
                  ? profileError.message
                  : 'Failed to load profile'
              }
              onRetry={() => refetchProfile()}
            />
          ) : isPodcastsError ? (
            <EmptyState
              title="Error"
              subtitle="Failed to load your podcasts"
            />
          ) : isPodcastsLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <EmptyState
              title="No podcasts yet"
              subtitle="Create your first podcast from the Create tab"
            />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.logoutButtonPressed,
              ]}
              onPress={handleLogout}
            >
              <Text style={styles.logoutButtonText}>Log Out</Text>
            </Pressable>
          </View>
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
    paddingHorizontal: spacing.xl,
  },
  listContent: {
    paddingBottom: spacing['2xl'],
  },
  profileSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  profileTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  settingsIcon: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  profileName: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  profileHandle: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  profileBio: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: typography.fontBody,
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: colors.border,
  },
  savedIdeasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  savedIdeasRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  savedIdeasIcon: {
    fontSize: 20,
    marginRight: spacing.sm + 4,
  },
  savedIdeasLabel: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  savedIdeasChevron: {
    fontFamily: typography.fontBody,
    fontSize: 22,
    color: colors.textTertiary,
    fontWeight: '300',
  },
  sectionHeader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
  },
  podcastItem: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  podcastItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  podcastItemContent: {
    padding: spacing.md,
  },
  podcastItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: spacing.sm,
  },
  podcastItemTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 17,
    color: colors.textPrimary,
    flex: 1,
  },
  podcastItemTopic: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  podcastItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  podcastItemStat: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
  },
  podcastItemDuration: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '500',
    marginLeft: 'auto',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  statusBadgeReady: {
    backgroundColor: colors.successLighter,
  },
  statusBadgePending: {
    backgroundColor: colors.warningLighter,
  },
  statusBadgeError: {
    backgroundColor: colors.errorLighter,
  },
  statusBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
  },
  statusBadgeTextReady: {
    color: colors.success,
  },
  statusBadgeTextPending: {
    color: colors.warning,
  },
  statusBadgeTextError: {
    color: colors.error,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  logoutButton: {
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutButtonPressed: {
    backgroundColor: colors.errorLighter,
  },
  logoutButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
});
