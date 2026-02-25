import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Alert,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import Constants from 'expo-constants';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { deleteToken } from '../lib/auth';

interface KeyStatus {
  provider: string;
  isValid: boolean;
}

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: aiKeys } = useQuery<{ keys: KeyStatus[] }>({
    queryKey: ['settings', 'ai-keys'],
    queryFn: async () => {
      const res = await api.get('/settings/ai-keys');
      return res.data;
    },
  });

  const { data: ttsKeys } = useQuery<{ keys: KeyStatus[] }>({
    queryKey: ['settings', 'byok'],
    queryFn: async () => {
      const res = await api.get('/settings/byok');
      return res.data;
    },
  });

  const hasAiKey = aiKeys?.keys?.some((k) => k.isValid) ?? false;
  const hasTtsKey = ttsKeys?.keys?.some((k) => k.isValid) ?? false;
  const allKeysConfigured = hasAiKey && hasTtsKey;

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, all your podcasts, comments, and data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Type DELETE to confirm. All your data will be permanently removed.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete Everything',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.delete('/users/me', {
                        data: { confirm: 'DELETE' },
                      });
                      await deleteToken();
                      queryClient.clear();
                      router.replace('/auth/login');
                    } catch {
                      Alert.alert(
                        'Error',
                        'Failed to delete account. Please try again.',
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [queryClient, router]);

  const appVersion = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Settings',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
              onPress={() => router.push('/settings/api-keys')}
            >
              <View style={styles.rowLabelWithStatus}>
                <Text style={styles.rowLabel}>API Keys</Text>
                <View
                  style={[
                    styles.keyStatusDot,
                    allKeysConfigured
                      ? styles.keyStatusDotGreen
                      : styles.keyStatusDotAmber,
                  ]}
                />
              </View>
              <Text style={styles.rowChevron}>{'\u203A'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.card}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
              onPress={() => openBrowserAsync('https://sotto.fm/privacy')}
            >
              <Text style={styles.rowLabel}>Privacy Policy</Text>
              <Text style={styles.rowChevron}>{'\u203A'}</Text>
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
              onPress={() => openBrowserAsync('https://sotto.fm/terms')}
            >
              <Text style={styles.rowLabel}>Terms of Service</Text>
              <Text style={styles.rowChevron}>{'\u203A'}</Text>
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
              onPress={() => openBrowserAsync('https://sotto.fm/support')}
            >
              <Text style={styles.rowLabel}>Support</Text>
              <Text style={styles.rowChevron}>{'\u203A'}</Text>
            </Pressable>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Version</Text>
              <Text style={styles.rowValue}>{appVersion}</Text>
            </View>
          </View>
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [
              styles.deleteButton,
              pressed && styles.deleteButtonPressed,
            ]}
            onPress={handleDeleteAccount}
          >
            <Text style={styles.deleteButtonText}>Delete Account</Text>
          </Pressable>
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
    paddingVertical: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  rowLabelWithStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  keyStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  keyStatusDotGreen: {
    backgroundColor: colors.success,
  },
  keyStatusDotAmber: {
    backgroundColor: colors.warning,
  },
  rowLabel: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
  },
  rowChevron: {
    fontSize: 22,
    color: colors.textTertiary,
  },
  rowValue: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
  },
  deleteButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  deleteButtonPressed: {
    backgroundColor: colors.errorLighter,
  },
  deleteButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
});
