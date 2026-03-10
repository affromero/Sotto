import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@sotto/shared';

interface EmptyStateProps {
  icon?: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon, iconName, title, subtitle }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {iconName ? (
        <Ionicons name={iconName} size={48} color={colors.textTertiary} style={styles.iconSpacing} />
      ) : icon ? (
        <Text style={styles.icon}>{icon}</Text>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  icon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  iconSpacing: {
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
