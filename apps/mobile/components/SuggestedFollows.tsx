import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { shadowSm } from '../lib/shadows';

interface SuggestedUser {
  id: string;
  name: string | null;
  handle: string | null;
  image: string | null;
}

export function SuggestedFollows() {
  const router = useRouter();

  const { data } = useQuery<{ users: SuggestedUser[] }>({
    queryKey: ['users', 'suggested'],
    queryFn: async () => {
      const res = await api.get('/users/suggested');
      return res.data;
    },
    staleTime: 10 * 60 * 1000,
  });

  const users = data?.users ?? [];
  if (users.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Suggested Follows</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {users.map((user) => (
          <Pressable
            key={user.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push(`/user/${user.id}`)}
            accessibilityLabel={`View ${user.name ?? 'user'}'s profile`}
            accessibilityRole="button"
          >
            <Avatar uri={user.image} name={user.name} size={52} />
            <Text style={styles.name} numberOfLines={1}>
              {user.name ?? 'Anonymous'}
            </Text>
            {user.handle && (
              <Text style={styles.handle} numberOfLines={1}>
                @{user.handle}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
  },
  card: {
    width: 90,
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    ...shadowSm,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  name: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  handle: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 1,
    textAlign: 'center',
  },
});
