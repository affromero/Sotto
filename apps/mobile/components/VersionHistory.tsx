import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastVersionSummary } from '@sotto/shared';
import { BottomSheet } from './BottomSheet';
import { timeAgo } from '../lib/formatters';
import { formatTime } from '../lib/formatters';

interface VersionHistoryProps {
  visible: boolean;
  onClose: () => void;
  versions: PodcastVersionSummary[];
  currentVersion: number;
}

export function VersionHistory({
  visible,
  onClose,
  versions,
  currentVersion,
}: VersionHistoryProps) {
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Version History">
      <View style={styles.wrapper}>
        {sorted.map((ver) => {
          const isCurrent = ver.version === currentVersion;
          return (
            <View
              key={ver.id}
              style={[styles.versionRow, isCurrent && styles.versionRowActive]}
            >
              <View style={styles.versionBadge}>
                <Text style={styles.versionNumber}>v{ver.version}</Text>
              </View>
              <View style={styles.versionInfo}>
                <Text style={styles.changeType}>
                  {ver.changeType.charAt(0) + ver.changeType.slice(1).toLowerCase().replace(/_/g, ' ')}
                </Text>
                {ver.changeSummary && (
                  <Text style={styles.changeSummary} numberOfLines={2}>
                    {ver.changeSummary}
                  </Text>
                )}
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{timeAgo(ver.createdAt)}</Text>
                  {ver.duration !== null && (
                    <Text style={styles.metaText}>
                      {formatTime(ver.duration)}
                    </Text>
                  )}
                </View>
              </View>
              {isCurrent && (
                <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
              )}
            </View>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingBottom: spacing.md,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    gap: spacing.md,
  },
  versionRowActive: {
    backgroundColor: colors.primaryLighter,
  },
  versionBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionNumber: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  versionInfo: {
    flex: 1,
  },
  changeType: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  changeSummary: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  metaText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
