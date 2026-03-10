import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Share,
  Alert,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { shadowSm, shadowMd } from '../../lib/shadows';

export default function ReferralScreen() {
  const { data: profile } = useQuery<{
    handle: string | null;
    name: string | null;
  }>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get('/users/me');
      return res.data;
    },
  });

  const handle = profile?.handle;
  const referralLink = handle
    ? `https://sotto.fm/ref/${handle}`
    : null;

  const handleShare = useCallback(async () => {
    if (!referralLink) {
      Alert.alert('Set Handle First', 'You need a handle to share your referral link. Set one in Edit Profile.');
      return;
    }
    await Share.share({
      message: `Join me on Sotto — the social podcast network!\n${referralLink}`,
      url: referralLink,
    });
  }, [referralLink]);

  const handleCopy = useCallback(async () => {
    if (!referralLink) {
      Alert.alert('Set Handle First', 'You need a handle to get a referral link.');
      return;
    }
    // Clipboard requires expo-clipboard, use Share as fallback
    await Share.share({ message: referralLink });
  }, [referralLink]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Refer a Friend' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Ionicons name="gift-outline" size={48} color={colors.primary} />
          <Text style={styles.heroTitle}>Invite Friends to Sotto</Text>
          <Text style={styles.heroDescription}>
            Share your referral link and grow the community. When friends sign
            up using your link, they get attributed to you.
          </Text>
        </View>

        {referralLink ? (
          <View style={styles.linkCard}>
            <Text style={styles.linkLabel}>Your Referral Link</Text>
            <Text style={styles.linkUrl} selectable>
              {referralLink}
            </Text>
            <View style={styles.linkActions}>
              <Pressable style={styles.copyButton} onPress={handleCopy}>
                <Ionicons name="copy-outline" size={18} color={colors.primary} />
                <Text style={styles.copyButtonText}>Copy</Text>
              </Pressable>
              <Pressable style={styles.shareButton} onPress={handleShare}>
                <Ionicons name="share-outline" size={18} color={colors.textInverse} />
                <Text style={styles.shareButtonText}>Share</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.noHandleCard}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.warning} />
            <Text style={styles.noHandleText}>
              Set a handle in Edit Profile to get your referral link.
            </Text>
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
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadowMd,
    marginBottom: spacing.lg,
  },
  heroTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  heroDescription: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  linkCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadowSm,
  },
  linkLabel: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  linkUrl: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  linkActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  copyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  copyButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  shareButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  noHandleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadowSm,
  },
  noHandleText: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
