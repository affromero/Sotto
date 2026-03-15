import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { borderRadius, colors, spacing, typography } from '@sotto/shared';

interface PillGroupProps {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onChange: (value: string) => void;
  testIDPrefix?: string;
}

export function PillGroup({ options, selected, onChange, testIDPrefix }: PillGroupProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
            style={({ pressed }) => [
              styles.pill,
              active ? styles.pillActive : styles.pillInactive,
              !active && pressed && styles.pillInactivePressed,
            ]}
          >
            <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  pill: {
    borderRadius: borderRadius.full,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  pillInactive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillInactivePressed: {
    borderColor: colors.primaryLight,
  },
  pillText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
  },
  pillTextActive: {
    color: colors.textInverse,
  },
  pillTextInactive: {
    color: colors.textPrimary,
  },
});
