import { Image, View, Text, StyleSheet } from 'react-native';
import { colors, typography } from '@sotto/shared';
import { shadowSm } from '../lib/shadows';

interface AvatarProps {
  uri: string | null | undefined;
  name: string | null | undefined;
  size: number;
}

export function Avatar({ uri, name, size }: AvatarProps) {
  const borderRadius = size / 2;
  const fontSize = size * 0.4;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius }]}
        accessibilityLabel={`${name ?? 'User'}'s avatar`}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius },
      ]}
    >
      <Text style={[styles.initial, { fontSize }]}>
        {(name ?? '?')[0].toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.border,
  },
  fallback: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primaryLight,
    ...shadowSm,
  },
  initial: {
    fontFamily: typography.fontHeading,
    color: colors.primary,
  },
});
