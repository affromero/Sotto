import { FlatList, Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { PodcastCard } from './PodcastCard';
import { EmptyState } from './EmptyState';

interface InspireTrendingListProps {
  podcasts: PodcastSummary[];
  isLoading: boolean;
  onSelectTopic: (topic: string) => void;
}

export function InspireTrendingList({
  podcasts,
  isLoading,
  onSelectTopic,
}: InspireTrendingListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading trending podcasts...</Text>
      </View>
    );
  }

  if (podcasts.length === 0) {
    return (
      <EmptyState
        icon={'\uD83D\uDD25'}
        title="Nothing trending yet"
        subtitle="Check back soon for popular podcasts."
      />
    );
  }

  return (
    <FlatList
      data={podcasts}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <PodcastCard
            podcast={item}
            variant="compact"
            onPress={() => router.push(`/podcast/${item.id}`)}
          />
          <Pressable
            style={({ pressed }) => [
              styles.makeButton,
              pressed && styles.makeButtonPressed,
            ]}
            onPress={() => onSelectTopic(item.topic)}
            accessibilityLabel={`Make a podcast like ${item.title}`}
          >
            <Text style={styles.makeButtonText}>Make one like this</Text>
          </Pressable>
        </View>
      )}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  list: {
    paddingBottom: spacing.lg,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  makeButton: {
    alignSelf: 'flex-start',
    marginLeft: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  makeButtonPressed: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  makeButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
});
