import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { BottomSheet } from './BottomSheet';

interface Collection {
  id: string;
  name: string;
  podcastCount: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  podcastId: string;
}

export function AddToCollectionSheet({ visible, onClose, podcastId }: Props) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const { data, isLoading } = useQuery<{ collections: Collection[] }>({
    queryKey: ['collections'],
    queryFn: async () => {
      const res = await api.get('/collections');
      return res.data;
    },
    enabled: visible,
  });

  const addMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      await api.post(`/collections/${collectionId}/items`, { podcastId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      Alert.alert('Added', 'Podcast added to collection.');
      onClose();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to add to collection.');
    },
  });

  const createAndAddMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/collections', { name: newName.trim() });
      const collectionId = res.data.id;
      await api.post(`/collections/${collectionId}/items`, { podcastId });
      return collectionId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setNewName('');
      setShowCreate(false);
      Alert.alert('Done', 'Collection created and podcast added.');
      onClose();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to create collection.');
    },
  });

  const handleClose = useCallback(() => {
    setShowCreate(false);
    setNewName('');
    onClose();
  }, [onClose]);

  const collections = data?.collections ?? [];

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      <Text style={styles.title}>Add to Collection</Text>

      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={styles.loader}
        />
      ) : (
        <ScrollView style={styles.list} bounces={false}>
          {collections.map((col) => (
            <Pressable
              key={col.id}
              style={styles.collectionRow}
              onPress={() => addMutation.mutate(col.id)}
              disabled={addMutation.isPending}
            >
              <View style={styles.collectionInfo}>
                <Text style={styles.collectionName} numberOfLines={1}>
                  {col.name}
                </Text>
                <Text style={styles.collectionCount}>
                  {col.podcastCount} podcast{col.podcastCount !== 1 ? 's' : ''}
                </Text>
              </View>
              <Ionicons name="add" size={22} color={colors.primary} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {showCreate ? (
        <View style={styles.createForm}>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="Collection name"
            placeholderTextColor={colors.textTertiary}
            maxLength={100}
            autoFocus
          />
          <Pressable
            style={[
              styles.createSaveButton,
              (!newName.trim() || createAndAddMutation.isPending) &&
                styles.createSaveButtonDisabled,
            ]}
            onPress={() => createAndAddMutation.mutate()}
            disabled={!newName.trim() || createAndAddMutation.isPending}
          >
            {createAndAddMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.createSaveButtonText}>Create & Add</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={styles.newCollectionButton}
          onPress={() => setShowCreate(true)}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.newCollectionButtonText}>New Collection</Text>
        </Pressable>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  loader: {
    paddingVertical: spacing.xl,
  },
  list: {
    maxHeight: 280,
    marginBottom: spacing.md,
  },
  collectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  collectionInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  collectionName: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  collectionCount: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: 2,
  },
  newCollectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  newCollectionButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  createForm: {
    gap: spacing.sm,
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
  },
  createSaveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  createSaveButtonDisabled: {
    opacity: 0.5,
  },
  createSaveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
