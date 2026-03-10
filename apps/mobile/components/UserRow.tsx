import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { Avatar } from './Avatar';
import { shadowSm } from '../lib/shadows';

interface UserRowProps {
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  onPress: () => void;
}

export function UserRow({ user, onPress }: UserRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityLabel={`${user.name ?? 'User'} profile`}
      accessibilityRole="button"
    >
      <Avatar uri={user.image} name={user.name} size={44} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {user.name ?? 'Anonymous'}
        </Text>
        {user.handle && (
          <Text style={styles.handle} numberOfLines={1}>
            @{user.handle}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: borderRadius.lg,
    ...shadowSm,
  },
  pressed: {
    backgroundColor: colors.surfaceHover,
  },
  info: {
    flex: 1,
    marginLeft: spacing.md,
  },
  name: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  handle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 1,
  },
});
