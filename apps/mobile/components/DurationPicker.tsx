import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '@sotto/shared';
import { PillGroup } from './PillGroup';

interface DurationPickerProps {
  value: number;
  onChange: (minutes: number) => void;
  max?: number;
}

export function DurationPicker({ value, onChange, max = 40 }: DurationPickerProps) {
  const options = [5, 10, 15, 20, 25, 30, 35, 40]
    .filter((m) => m <= max)
    .map((m) => ({ value: String(m), label: `${m} min` }));

  return (
    <View>
      <Text style={styles.label}>Duration</Text>
      <PillGroup
        options={options}
        selected={String(value)}
        onChange={(val) => onChange(Number(val))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
});
