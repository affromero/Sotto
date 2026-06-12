import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { openBrowserAsync } from 'expo-web-browser';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { ReferenceData } from '@sotto/shared';
import { shadowSm } from '../lib/shadows';

const STATUS_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  VERIFIED: { icon: 'checkmark-circle', color: colors.success },
  PARTIALLY_VERIFIED: { icon: 'alert-circle', color: colors.warning },
  UNVERIFIED: { icon: 'help-circle', color: colors.textTertiary },
  FAILED: { icon: 'close-circle', color: colors.error },
};

interface ReferencesTabProps {
  references: ReferenceData[];
}

export function ReferencesTab({ references }: ReferencesTabProps) {
  if (references.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No references for this episode.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>References</Text>
        <Text style={styles.count}>{references.length}</Text>
      </View>
      {references.map((ref) => {
        const status = STATUS_ICONS[ref.verificationStatus] ?? STATUS_ICONS.UNVERIFIED;
        return (
          <Pressable
            key={ref.id}
            style={({ pressed }) => [styles.card, pressed && ref.url && styles.cardPressed]}
            onPress={() => {
              if (ref.url) openBrowserAsync(ref.url);
            }}
            disabled={!ref.url}
            accessibilityLabel={`Reference: ${ref.title}`}
            accessibilityRole={ref.url ? 'link' : 'text'}
          >
            <View style={styles.refHeader}>
              <Text style={styles.refNumber}>[{ref.number}]</Text>
              <Ionicons name={status.icon} size={16} color={status.color} />
            </View>
            <Text style={styles.refTitle} numberOfLines={2}>
              {ref.title}
            </Text>
            {ref.authors.length > 0 && (
              <Text style={styles.refAuthors} numberOfLines={1}>
                {ref.authors.join(', ')}
                {ref.year ? ` (${ref.year})` : ''}
              </Text>
            )}
            {ref.publisher && (
              <Text style={styles.refPublisher} numberOfLines={1}>
                {ref.publisher}
              </Text>
            )}
            {ref.url && (
              <View style={styles.linkRow}>
                <Ionicons name="open-outline" size={12} color={colors.accent} />
                <Text style={styles.linkText} numberOfLines={1}>
                  {ref.contentDomain ?? new URL(ref.url).hostname}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  count: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadowSm,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  refHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  refNumber: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  refTitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 21,
    marginBottom: 2,
  },
  refAuthors: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  refPublisher: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  linkText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.accent,
  },
});
