import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '@sotto/shared';
import { PillGroup } from './PillGroup';

interface VisibilityPickerProps {
  value: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  onChange: (v: 'PUBLIC' | 'UNLISTED' | 'PRIVATE') => void;
}

const options = [
  { value: 'PUBLIC', label: 'Public' },
  { value: 'UNLISTED', label: 'Unlisted' },
  { value: 'PRIVATE', label: 'Private' },
];

export function VisibilityPicker({ value, onChange }: VisibilityPickerProps) {
  return (
    <View>
      <Text style={styles.label}>Visibility</Text>
      <PillGroup
        options={options}
        selected={value}
        onChange={(val) => onChange(val as 'PUBLIC' | 'UNLISTED' | 'PRIVATE')}
        testIDPrefix="visibility"
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
