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
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowSm } from '../../lib/shadows';
import type { NotificationData } from '@sotto/shared';
import { api } from '../../lib/api';
import { globalStyles } from '../../lib/theme';
import { timeAgo } from '../../lib/formatters';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';

const NOTIFICATION_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  EPISODE_READY: 'headset',
  EPISODE_FAILED: 'warning-outline',
  INTERACTION_ANSWERED: 'chatbubble-outline',
  SYSTEM: 'information-circle-outline',
};

function getNotificationIcon(type: string): keyof typeof Ionicons.glyphMap {
  return NOTIFICATION_ICONS[type] ?? 'notifications-outline';
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
      testID={`notifications-item-${notification.id}`}
    >
      <View style={styles.iconContainer}>
        <Ionicons
          name={getNotificationIcon(notification.type)}
          size={20}
          color={colors.textSecondary}
        />
      </View>
      <View style={styles.notificationContent}>
        <View style={styles.notificationHeader}>
          <Text
            style={[styles.notificationTitle, !notification.read && styles.notificationTitleUnread]}
            numberOfLines={1}
          >
            {notification.title}
          </Text>
          <Text style={styles.notificationTime}>{timeAgo(notification.createdAt)}</Text>
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
      const response = await api.get<{ notifications: NotificationData[] }>('/notifications');
      return response.data.notifications;
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
      await Promise.all(unread.map((n) => api.patch(`/notifications/${n.id}`, { read: true })));
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
      if (notification.data?.episodeId) {
        router.push(`/episode/${notification.data.episodeId}`);
      }
    },
    [markReadMutation, router]
  );

  const hasUnread = notifications?.some((n) => !n.read) ?? false;

  const renderItem = useCallback(
    ({ item }: { item: NotificationData }) => (
      <NotificationItem notification={item} onPress={() => handleNotificationPress(item)} />
    ),
    [handleNotificationPress]
  );

  const keyExtractor = useCallback((item: NotificationData) => item.id, []);

  return (
    <View style={globalStyles.screenContainer}>
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
            testID="notifications-mark-all-read"
          >
            <Text style={styles.markAllButtonText}>
              {markAllReadMutation.isPending ? 'Marking...' : 'Mark all as read'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={notifications}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        testID="notifications-list"
        contentContainerStyle={
          !notifications || notifications.length === 0
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
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : isError ? (
            <ErrorState
              message={error instanceof Error ? error.message : 'Failed to load notifications'}
              onRetry={() => refetch()}
            />
          ) : (
            <EmptyState
              iconName="notifications-outline"
              title="No notifications yet"
              subtitle="When a lesson finishes generating or a question is answered, you will see it here."
            />
          )
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    zIndex: 1,
    ...shadowSm,
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
});
