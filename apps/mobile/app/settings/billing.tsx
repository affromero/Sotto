import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { shadowSm, shadowMd } from '../../lib/shadows';

interface BillingData {
  tier: 'FREE' | 'PRO';
  podcastCount: number;
  limits: {
    maxDurationMinutes: number;
    maxVoiceClones: number;
    canMakePrivate: boolean;
    canExportPdf: boolean;
    hasPremiumSfx: boolean;
  };
}

export default function BillingScreen() {
  const { data, isLoading } = useQuery<BillingData>({
    queryKey: ['billing', 'usage'],
    queryFn: async () => {
      const res = await api.get('/billing/usage');
      return res.data;
    },
  });

  const handleUpgrade = async () => {
    try {
      const res = await api.post('/billing/checkout', {
        successUrl: 'https://sotto.fm/settings?upgraded=true',
        cancelUrl: 'https://sotto.fm/settings',
      });
      await openBrowserAsync(res.data.url);
    } catch {
      Alert.alert('Error', 'Failed to open checkout. Try again.');
    }
  };

  const handleManage = async () => {
    try {
      const res = await api.post('/billing/portal', {
        returnUrl: 'https://sotto.fm/settings',
      });
      await openBrowserAsync(res.data.url);
    } catch {
      Alert.alert('Error', 'Failed to open billing portal.');
    }
  };

  const isPro = data?.tier === 'PRO';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Billing & Plan' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : data ? (
          <>
            {/* Current Plan */}
            <View style={styles.planCard}>
              <View style={styles.planBadge}>
                <Ionicons
                  name={isPro ? 'diamond' : 'leaf-outline'}
                  size={24}
                  color={isPro ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.planName}>{isPro ? 'Pro' : 'Free'}</Text>
              </View>
              <Text style={styles.planDescription}>
                {isPro
                  ? 'Unlimited features, private podcasts, voice clones.'
                  : 'Basic podcast creation with community features.'}
              </Text>
            </View>

            {/* Limits */}
            <Text style={styles.sectionTitle}>Your Limits</Text>
            <View style={styles.limitsCard}>
              {[
                {
                  label: 'Max Duration',
                  value:
                    data.limits.maxDurationMinutes >= 9999
                      ? 'Unlimited'
                      : `${data.limits.maxDurationMinutes} min`,
                  icon: 'time-outline',
                },
                {
                  label: 'Voice Clones',
                  value: String(data.limits.maxVoiceClones),
                  icon: 'mic-outline',
                },
                {
                  label: 'Private Podcasts',
                  value: data.limits.canMakePrivate ? 'Yes' : 'No',
                  icon: 'lock-closed-outline',
                },
                {
                  label: 'PDF Export',
                  value: data.limits.canExportPdf ? 'Yes' : 'No',
                  icon: 'document-outline',
                },
                {
                  label: 'Premium SFX',
                  value: data.limits.hasPremiumSfx ? 'Yes' : 'No',
                  icon: 'musical-notes-outline',
                },
              ].map((item, i, arr) => (
                <View key={item.label}>
                  <View style={styles.limitRow}>
                    <View style={styles.limitLeft}>
                      <Ionicons
                        name={item.icon as keyof typeof Ionicons.glyphMap}
                        size={18}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.limitLabel}>{item.label}</Text>
                    </View>
                    <Text style={styles.limitValue}>{item.value}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={styles.separator} />}
                </View>
              ))}
            </View>

            {/* Actions */}
            {isPro ? (
              <Pressable style={styles.manageButton} onPress={handleManage}>
                <Text style={styles.manageButtonText}>Manage Subscription</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.upgradeButton} onPress={handleUpgrade}>
                <Ionicons name="diamond" size={18} color={colors.textInverse} />
                <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
              </Pressable>
            )}
          </>
        ) : null}
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
  centered: {
    paddingVertical: spacing.xl * 2,
    alignItems: 'center',
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadowMd,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  planName: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
  },
  planDescription: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  sectionTitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  limitsCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowSm,
  },
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  limitLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  limitLabel: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
  },
  limitValue: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.md,
  },
  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  upgradeButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  manageButton: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  manageButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});
