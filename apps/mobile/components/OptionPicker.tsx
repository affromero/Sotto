import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@sotto/shared';

interface OptionPickerProps {
  options: Array<{
    id: string;
    label: string;
    badge?: string;
    group?: string;
    disabled?: boolean;
  }>;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}

export function OptionPicker({ options, selectedId, onSelect }: OptionPickerProps) {
  const grouped = groupOptions(options);

  return (
    <View>
      {grouped.map(({ group, items }) => (
        <View key={group ?? '__default'}>
          {group ? <Text style={styles.sectionHeader}>{group.toUpperCase()}</Text> : null}
          {items.map((option) => {
            const selected = option.id === selectedId;
            return (
              <Pressable
                key={option.id}
                disabled={option.disabled}
                onPress={() => onSelect(selected ? undefined : option.id)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && !option.disabled && styles.rowPressed,
                  option.disabled && styles.rowDisabled,
                ]}
              >
                <View style={styles.labelContainer}>
                  <Text style={styles.label}>{option.label}</Text>
                  {option.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{option.badge}</Text>
                    </View>
                  ) : null}
                  {option.disabled ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>No key</Text>
                    </View>
                  ) : null}
                </View>
                {selected ? <Text style={styles.checkmark}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

interface GroupedOptions {
  group: string | undefined;
  items: OptionPickerProps['options'];
}

function groupOptions(options: OptionPickerProps['options']): GroupedOptions[] {
  const map = new Map<string | undefined, OptionPickerProps['options']>();

  for (const option of options) {
    const key = option.group;
    const list = map.get(key);
    if (list) {
      list.push(option);
    } else {
      map.set(key, [option]);
    }
  }

  const result: GroupedOptions[] = [];
  // Default group (no header) first
  const defaultGroup = map.get(undefined);
  if (defaultGroup) {
    result.push({ group: undefined, items: defaultGroup });
    map.delete(undefined);
  }
  for (const [group, items] of map) {
    result.push({ group, items });
  }
  return result;
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    color: colors.textTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
  },
  badge: {
    backgroundColor: colors.primaryLighter,
    borderRadius: 9999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.primary,
  },
  checkmark: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
});
