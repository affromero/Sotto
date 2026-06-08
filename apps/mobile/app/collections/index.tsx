import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { shadowSm } from '../../lib/shadows';
import { BottomSheet } from '../../components/BottomSheet';
import { ErrorState } from '../../components/ErrorState';

interface Collection {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  podcastCount: number;
  createdAt: string;
}

export default function CollectionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [createVisible, setCreateVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const { data, isLoading, isError, refetch } = useQuery<{ collections: Collection[] }>({
    queryKey: ['collections'],
    queryFn: async () => {
      const res = await api.get('/collections');
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post('/collections', {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setCreateVisible(false);
      setNewName('');
      setNewDescription('');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to create collection.');
    },
  });

  const renderItem = useCallback(
    ({ item }: { item: Collection }) => (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/collections/${item.id}`)}
        testID={`collections-card-${item.id}`}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <Ionicons
            name={item.isPublic ? 'globe-outline' : 'lock-closed-outline'}
            size={16}
            color={colors.textTertiary}
          />
        </View>
        {item.description && (
          <Text style={styles.cardDescription} numberOfLines={2}>
            {item.description}
          </Text>
        )}
        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>
            {item.podcastCount} podcast{item.podcastCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </Pressable>
    ),
    [router]
  );

  const collections = data?.collections ?? [];

  if (isError) {
    return <ErrorState message="Failed to load" onRetry={refetch} />;
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Collections',
          headerRight: () => (
            <Pressable
              onPress={() => setCreateVisible(true)}
              hitSlop={8}
              style={{ marginRight: spacing.sm }}
              testID="collections-add-button"
            >
              <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
            </Pressable>
          ),
        }}
      />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : collections.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="albums-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>No collections yet</Text>
          <Pressable
            style={styles.createButton}
            onPress={() => setCreateVisible(true)}
            testID="collections-create-button"
          >
            <Text style={styles.createButtonText}>Create Collection</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="collections-list"
          data={collections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      <BottomSheet visible={createVisible} onClose={() => setCreateVisible(false)}>
        <Text style={styles.sheetTitle}>New Collection</Text>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="Collection name"
          placeholderTextColor={colors.textTertiary}
          maxLength={100}
          autoFocus
          testID="collections-new-name-input"
        />
        <TextInput
          style={[styles.input, styles.descriptionInput]}
          value={newDescription}
          onChangeText={setNewDescription}
          placeholder="Description (optional)"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={500}
          testID="collections-new-description-input"
        />
        <Pressable
          style={[
            styles.saveButton,
            (!newName.trim() || createMutation.isPending) && styles.saveButtonDisabled,
          ]}
          onPress={() => createMutation.mutate()}
          disabled={!newName.trim() || createMutation.isPending}
          testID="collections-new-save-button"
        >
          {createMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.saveButtonText}>Create</Text>
          )}
        </Pressable>
      </BottomSheet>
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
    padding: spacing.xl,
    gap: spacing.md,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadowSm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cardName: {
    fontFamily: typography.fontBody,
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  cardDescription: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  cardMetaText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textTertiary,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  createButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
  sheetTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  input: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  descriptionInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
