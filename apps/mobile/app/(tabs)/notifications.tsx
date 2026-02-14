import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { NotificationData } from '@sotto/shared';
import { api } from '../../lib/api';

const NOTIFICATION_ICONS: Record<string, string> = {
  PODCAST_READY: '\u{1F3A7}',
  PODCAST_FAILED: '\u{26A0}',
  NEW_FOLLOWER: '\u{1F464}',
  NEW_LIKE: '\u{2764}',
  NEW_FORK: '\u{1F500}',
  INTERACTION_ANSWERED: '\u{1F4AC}',
  NEW_COMMENT: '\u{1F4DD}',
  SYSTEM: '\u{2139}',
};

function getNotificationIcon(type: string): string {
  return NOTIFICATION_ICONS[type] ?? '\u{1F514}';
}

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function NotificationItem({
  notification,
  onPress,
}: {
  notification: NotificationData;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.notificationItem,
        !notification.read && styles.notificationItemUnread,
        pressed && styles.notificationItemPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.iconText}>
          {getNotificationIcon(notification.type)}
        </Text>
      </View>
      <View style={styles.notificationContent}>
        <View style={styles.notificationHeader}>
          <Text
            style={[
              styles.notificationTitle,
              !notification.read && styles.notificationTitleUnread,
            ]}
            numberOfLines={1}
          >
            {notification.title}
          </Text>
          <Text style={styles.notificationTime}>
            {timeAgo(notification.createdAt)}
          </Text>
        </View>
        <Text style={styles.notificationMessage} numberOfLines={2}>
          {notification.message}
        </Text>
      </View>
      {!notification.read ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: notifications,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery<NotificationData[]>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await api.get<NotificationData[]>('/notifications');
      return response.data;
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await api.patch(`/notifications/${notificationId}`, { read: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unread = notifications?.filter((n) => !n.read) ?? [];
      await Promise.all(
        unread.map((n) =>
          api.patch(`/notifications/${n.id}`, { read: true }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleNotificationPress = useCallback(
    (notification: NotificationData) => {
      if (!notification.read) {
        markReadMutation.mutate(notification.id);
      }
      if (notification.data?.podcastId) {
        router.push(`/podcast/${notification.data.podcastId}`);
      }
    },
    [markReadMutation, router],
  );

  const hasUnread =
    notifications?.some((n) => !n.read) ?? false;

  const renderItem = useCallback(
    ({ item }: { item: NotificationData }) => (
      <NotificationItem
        notification={item}
        onPress={() => handleNotificationPress(item)}
      />
    ),
    [handleNotificationPress],
  );

  const keyExtractor = useCallback(
    (item: NotificationData) => item.id,
    [],
  );

  return (
    <View style={styles.container}>
      {hasUnread ? (
        <View style={styles.headerBar}>
          <Pressable
            style={({ pressed }) => [
              styles.markAllButton,
              pressed && styles.markAllButtonPressed,
              markAllReadMutation.isPending && styles.markAllButtonDisabled,
            ]}
            onPress={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            <Text style={styles.markAllButtonText}>
              {markAllReadMutation.isPending
                ? 'Marking...'
                : 'Mark all as read'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            {error instanceof Error
              ? error.message
              : 'Failed to load notifications'}
          </Text>
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            notifications?.length === 0
              ? styles.emptyListContainer
              : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>{'\u{1F514}'}</Text>
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptySubtitle}>
                When someone likes your podcast, follows you, or your podcast
                finishes generating, you will see it here.
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  markAllButton: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primarySubtle,
  },
  markAllButtonPressed: {
    backgroundColor: colors.primaryLight,
  },
  markAllButtonDisabled: {
    opacity: 0.6,
  },
  markAllButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  emptyListContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  notificationItemUnread: {
    backgroundColor: colors.primaryLighter,
  },
  notificationItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm + 4,
  },
  iconText: {
    fontSize: 20,
  },
  notificationContent: {
    flex: 1,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  notificationTitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  notificationTitleUnread: {
    fontWeight: '600',
  },
  notificationTime: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  notificationMessage: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginLeft: spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 44 + spacing.sm + 4,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
  },
  retryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
