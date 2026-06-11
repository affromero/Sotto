import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { shadowSm } from '../../lib/shadows';
import { ErrorState } from '../../components/ErrorState';

const PROVIDER_ICONS: Record<string, { icon: string; label: string }> = {
  google: { icon: 'logo-google', label: 'Google' },
  github: { icon: 'logo-github', label: 'GitHub' },
  apple: { icon: 'logo-apple', label: 'Apple' },
  twitter: { icon: 'logo-twitter', label: 'Twitter / X' },
};

export default function ConnectedAccountsScreen() {
  const { data, isLoading, isError, refetch } = useQuery<{
    accounts: { provider: string; providerAccountId: string }[];
  }>({
    queryKey: ['user', 'me', 'accounts'],
    queryFn: async () => {
      const res = await api.get('/users/me');
      return {
        accounts: res.data.accounts ?? [],
      };
    },
  });

  const accounts = data?.accounts ?? [];

  if (isError) {
    return <ErrorState message="Failed to load" onRetry={refetch} />;
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Connected Accounts' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.description}>
          Accounts linked for sign-in. Manage connections from the web app.
        </Text>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : accounts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No connected accounts found.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {accounts.map((account, index) => {
              const meta = PROVIDER_ICONS[account.provider] ?? {
                icon: 'link-outline',
                label: account.provider,
              };
              return (
                <View key={`${account.provider}-${account.providerAccountId}`}>
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Ionicons
                        name={meta.icon as keyof typeof Ionicons.glyphMap}
                        size={22}
                        color={colors.textPrimary}
                      />
                      <Text style={styles.rowLabel}>{meta.label}</Text>
                    </View>
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.success}
                    />
                  </View>
                  {index < accounts.length - 1 && (
                    <View style={styles.separator} />
                  )}
                </View>
              );
            })}
          </View>
        )}
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
  description: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowSm,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadowSm,
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textTertiary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
