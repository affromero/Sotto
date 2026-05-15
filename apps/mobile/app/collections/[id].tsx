import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../../lib/api';
import { PodcastCard } from '../../components/PodcastCard';
import { ErrorState } from '../../components/ErrorState';

interface CollectionDetail {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  podcastCount: number;
  user: { id: string; name: string | null; handle: string | null; image: string | null };
  items: PodcastSummary[];
  isOwner: boolean;
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: collection,
    isLoading,
    isError,
    refetch,
  } = useQuery<CollectionDetail>({
    queryKey: ['collection', id],
    queryFn: async () => {
      const res = await api.get(`/collections/${id}`);
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/collections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      router.back();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete collection.');
    },
  });

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Collection', 'This cannot be undone. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteMutation.mutate(),
      },
    ]);
  }, [deleteMutation]);

  const removeMutation = useMutation({
    mutationFn: async (podcastId: string) => {
      await api.delete(`/collections/${id}/items`, {
        data: { podcastId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection', id] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to remove podcast.');
    },
  });

  const renderItem = useCallback(
    ({ item }: { item: PodcastSummary }) => (
      <View>
        <PodcastCard
          podcast={item}
          variant="compact"
          onPress={() => router.push(`/podcast/${item.id}`)}
        />
        {collection?.isOwner && (
          <Pressable
            style={styles.removeButton}
            onPress={() => removeMutation.mutate(item.id)}
            testID={`collection-detail-remove-${item.id}`}
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.error} />
            <Text style={styles.removeButtonText}>Remove</Text>
          </Pressable>
        )}
      </View>
    ),
    [collection?.isOwner, removeMutation, router]
  );

  if (isLoading || !collection) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return <ErrorState message="Failed to load" onRetry={refetch} />;
  }

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Text style={styles.headerName} testID="collection-detail-name">
          {collection.name}
        </Text>
        <Ionicons
          name={collection.isPublic ? 'globe-outline' : 'lock-closed-outline'}
          size={18}
          color={colors.textTertiary}
        />
      </View>
      {collection.description && (
        <Text style={styles.headerDescription}>{collection.description}</Text>
      )}
      <Text style={styles.headerMeta}>
        By {collection.user?.name ?? collection.user?.handle ?? 'Unknown'}
        {' \u00B7 '}
        {collection.podcastCount} podcast{collection.podcastCount !== 1 ? 's' : ''}
      </Text>

      {collection.isOwner && (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.deleteCollectionButton}
            onPress={handleDelete}
            testID="collection-detail-delete-button"
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: collection.name }} />
      <FlatList
        testID="collection-detail-list"
        data={collection.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="musical-notes-outline" size={40} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No podcasts in this collection yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    marginBottom: spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerName: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  headerDescription: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  headerMeta: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    marginBottom: spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  deleteCollectionButton: {
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-end',
  },
  removeButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.error,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textTertiary,
  },
});
