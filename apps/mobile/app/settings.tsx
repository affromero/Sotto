import { useCallback, useState, useEffect } from 'react';
import { View, Text, Pressable, Switch, Alert, ScrollView, StyleSheet } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { colors as defaultColors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowSm } from '../lib/shadows';
import { useThemeColors, useThemeStore } from '../lib/useThemeColors';
import { api } from '../lib/api';
import { appUrl } from '../lib/config';
import { deleteToken } from '../lib/auth';

interface KeyStatus {
  provider: string;
  isValid: boolean;
}

const SCHEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const;
const SCHEME_OPTIONS = ['system', 'light', 'dark'] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const colors = useThemeColors();
  const scheme = useThemeStore((s) => s.scheme);
  const setScheme = useThemeStore((s) => s.setScheme);

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
      'This will permanently delete your account, all your podcasts, settings, and data. This cannot be undone.',
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
                      Alert.alert('Error', 'Failed to delete account. Please try again.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [queryClient, router]);

  const appVersion = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Settings',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />
      <ScrollView contentContainerStyle={styles.scrollContent} testID="settings-scroll">
        {/* Account Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Account</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/settings/profile')}
              testID="settings-edit-profile"
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Edit Profile</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/settings/api-keys')}
              testID="settings-api-keys"
            >
              <View style={styles.rowLabelWithStatus}>
                <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>API Keys</Text>
                <View
                  style={[
                    styles.keyStatusDot,
                    allKeysConfigured ? styles.keyStatusDotGreen : styles.keyStatusDotAmber,
                  ]}
                />
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/settings/interests')}
              testID="settings-interests"
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Interests</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/settings/accounts')}
              testID="settings-connected-accounts"
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                Connected Accounts
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/settings/voices')}
              testID="settings-voice-clones"
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Voice Clones</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        </View>

        {/* Creator Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Creator</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/analytics')}
              testID="settings-analytics"
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Analytics</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => router.push('/settings/referral')}
              testID="settings-referral"
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Refer a Friend</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        </View>

        {/* Appearance Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Appearance</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>Theme</Text>
              <View style={styles.schemeRow}>
                {SCHEME_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt}
                    style={[
                      styles.schemeChip,
                      { borderColor: colors.border },
                      scheme === opt && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                    onPress={() => setScheme(opt)}
                    testID={`settings-theme-${opt}`}
                  >
                    <Text
                      style={[
                        styles.schemeChipText,
                        { color: colors.textSecondary },
                        scheme === opt && { color: colors.textInverse },
                      ]}
                    >
                      {SCHEME_LABELS[opt]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Legal</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => openBrowserAsync(appUrl('/privacy'))}
            >
              <Text style={styles.rowLabel}>Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => openBrowserAsync(appUrl('/terms'))}
            >
              <Text style={styles.rowLabel}>Terms of Service</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.rowSeparator} />
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => openBrowserAsync(appUrl('/support'))}
            >
              <Text style={styles.rowLabel}>Support</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>About</Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
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
              { borderColor: colors.error },
              pressed && { backgroundColor: colors.errorLighter },
            ]}
            onPress={handleDeleteAccount}
            testID="settings-delete-account"
          >
            <Text style={[styles.deleteButtonText, { color: colors.error }]}>Delete Account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    color: defaultColors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: defaultColors.surface,
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
  rowPressed: {
    backgroundColor: defaultColors.surfaceHover,
  },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: defaultColors.border,
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
    backgroundColor: defaultColors.success,
  },
  keyStatusDotAmber: {
    backgroundColor: defaultColors.warning,
  },
  rowLabel: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: defaultColors.textPrimary,
  },
  rowChevron: {
    fontSize: 22,
    color: defaultColors.textTertiary,
  },
  rowValue: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: defaultColors.textSecondary,
  },
  deleteButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: defaultColors.error,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  deleteButtonPressed: {
    backgroundColor: defaultColors.errorLighter,
  },
  deleteButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
  },
  schemeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  schemeChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  schemeChipText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
  },
});
