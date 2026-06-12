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
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowSm } from '../../lib/shadows';
import type { EpisodeSummary } from '@sotto/shared';
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
  episodeCount: number;
}

interface UserEpisodesResponse {
  episodes: EpisodeSummary[];
}

function StatusBadge({ status }: { status: string }) {
  const isReady = status === 'READY';
  const isPending =
    status === 'PENDING' ||
    status === 'DISCOVERING' ||
    status === 'EXTRACTING' ||
    status === 'RESEARCHING' ||
    status === 'PLANNING' ||
    status === 'SCRIPTING' ||
    status === 'COMPILING' ||
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

function MyEpisodeItem({ episode, onPress }: { episode: EpisodeSummary; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.episodeItem, pressed && styles.episodeItemPressed]}
      onPress={onPress}
    >
      <View style={styles.episodeItemContent}>
        <View style={styles.episodeItemHeader}>
          <Text style={styles.episodeItemTitle} numberOfLines={1}>
            {episode.title}
          </Text>
          <StatusBadge status={episode.status} />
        </View>
        <Text style={styles.episodeItemTopic} numberOfLines={1}>
          {episode.topic}
        </Text>
        <View style={styles.episodeItemMeta}>
          <View style={styles.episodeItemStatRow}>
            <Ionicons name="play" size={13} color={colors.textTertiary} />
            <Text style={styles.episodeItemStat}>{formatCount(episode.playCount)}</Text>
          </View>
          <Text style={styles.episodeItemDuration}>{formatDuration(episode.duration)}</Text>
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
    data: episodesData,
    isLoading: isEpisodesLoading,
    isError: isEpisodesError,
    refetch: refetchEpisodes,
    isRefetching,
  } = useQuery<UserEpisodesResponse>({
    queryKey: ['user', 'me', 'episodes'],
    queryFn: async () => {
      const response = await api.get<UserEpisodesResponse>('/users/me/episodes');
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
    refetchEpisodes();
  }, [refetchProfile, refetchEpisodes]);

  const episodes = episodesData?.episodes ?? [];
  const isLoading = isProfileLoading || isEpisodesLoading;

  const renderEpisodeItem = useCallback(
    ({ item }: { item: EpisodeSummary }) => (
      <MyEpisodeItem episode={item} onPress={() => router.push(`/episode/${item.id}`)} />
    ),
    [router]
  );

  const keyExtractor = useCallback((item: EpisodeSummary) => item.id, []);

  const profileHeader = (
    <View style={styles.profileSection}>
      <View style={styles.profileTopRow}>
        <Avatar uri={profile?.image} name={profile?.name} size={80} />
        <Pressable
          style={styles.settingsButton}
          onPress={handleSettingsPress}
          hitSlop={8}
          testID="profile-settings-button"
        >
          <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <Text style={styles.profileName}>{profile?.name ?? 'Anonymous'}</Text>
      {profile?.handle ? <Text style={styles.profileHandle}>@{profile.handle}</Text> : null}

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{formatCount(profile?.episodeCount ?? 0)}</Text>
          <Text style={styles.statLabel}>Lessons</Text>
        </View>
      </View>


      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Lessons</Text>
      </View>
    </View>
  );

  return (
    <View style={globalStyles.screenContainer}>
      <FlatList
        testID="profile-episode-list"
        data={episodes}
        renderItem={renderEpisodeItem}
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
                profileError instanceof Error ? profileError.message : 'Failed to load profile'
              }
              onRetry={() => refetchProfile()}
            />
          ) : isEpisodesError ? (
            <EmptyState title="Error" subtitle="Failed to load your lessons" />
          ) : isEpisodesLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <EmptyState
              title="No lessons yet"
              subtitle="Create your first lesson from the Create tab"
            />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}
              onPress={handleLogout}
              testID="profile-logout-button"
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
    ...shadowSm,
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
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    ...shadowSm,
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
  sectionHeader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
  },
  episodeItem: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    ...shadowSm,
  },
  episodeItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  episodeItemContent: {
    padding: spacing.md,
  },
  episodeItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: spacing.sm,
  },
  episodeItemTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 17,
    color: colors.textPrimary,
    flex: 1,
  },
  episodeItemTopic: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  episodeItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  episodeItemStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  episodeItemStat: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
  },
  episodeItemDuration: {
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
