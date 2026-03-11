import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { shadowSm } from '../../lib/shadows';

interface NotificationPrefs {
  likes: boolean;
  comments: boolean;
  forks: boolean;
  follows: boolean;
  mentions: boolean;
}

const PREF_LABELS: Record<keyof NotificationPrefs, string> = {
  likes: 'Likes',
  comments: 'Comments & Replies',
  forks: 'Forks & Remixes',
  follows: 'New Followers',
  mentions: 'Mentions',
};

export default function NotificationPrefsScreen() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery<NotificationPrefs>({
    queryKey: ['user', 'me', 'notification-prefs'],
    queryFn: async () => {
      const res = await api.get('/users/me');
      const user = res.data;
      return {
        likes: user.notifyLikes ?? true,
        comments: user.notifyComments ?? true,
        forks: user.notifyForks ?? true,
        follows: user.notifyFollows ?? true,
        mentions: user.notifyMentions ?? true,
      };
    },
  });

  const [localPrefs, setLocalPrefs] = useState<NotificationPrefs | null>(null);
  const active = localPrefs ?? prefs ?? {
    likes: true,
    comments: true,
    forks: true,
    follows: true,
    mentions: true,
  };

  const saveMutation = useMutation({
    mutationFn: async (updated: NotificationPrefs) => {
      await api.patch('/users/me', {
        notifyLikes: updated.likes,
        notifyComments: updated.comments,
        notifyForks: updated.forks,
        notifyFollows: updated.follows,
        notifyMentions: updated.mentions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to save notification preferences.');
    },
  });

  const togglePref = useCallback(
    (key: keyof NotificationPrefs) => {
      const updated = { ...active, [key]: !active[key] };
      setLocalPrefs(updated);
      saveMutation.mutate(updated);
    },
    [active, saveMutation],
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          {(Object.keys(PREF_LABELS) as (keyof NotificationPrefs)[]).map(
            (key, index, arr) => (
              <View key={key}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{PREF_LABELS[key]}</Text>
                  <Switch
                    value={active[key]}
                    onValueChange={() => togglePref(key)}
                    trackColor={{
                      false: colors.border,
                      true: colors.primary,
                    }}
                    thumbColor={colors.surface}
                    testID={`notif-pref-${key}`}
                  />
                </View>
                {index < arr.length - 1 && <View style={styles.separator} />}
              </View>
            ),
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowSm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  rowLabel: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
});
