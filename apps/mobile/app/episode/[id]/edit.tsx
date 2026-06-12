import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../../lib/api';
import { ErrorState } from '../../../components/ErrorState';
import { shadowSm } from '../../../lib/shadows';

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

const VISIBILITY_OPTIONS: { value: Visibility; label: string; icon: string }[] = [
  { value: 'PUBLIC', label: 'Public', icon: 'globe-outline' },
  { value: 'UNLISTED', label: 'Unlisted', icon: 'link-outline' },
  { value: 'PRIVATE', label: 'Private', icon: 'lock-closed-outline' },
];

export default function EpisodeEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: episode, isLoading, isError, refetch } = useQuery<{
    id: string;
    title: string;
    topic: string | null;
    visibility: Visibility;
    user: { id: string };
  }>({
    queryKey: ['episode', id],
    queryFn: async () => {
      const res = await api.get(`/episodes/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE');
  const [initialized, setInitialized] = useState(false);

  if (episode && !initialized) {
    setTitle(episode.title ?? '');
    setTopic(episode.topic ?? '');
    setVisibility(episode.visibility ?? 'PRIVATE');
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/episodes/${id}`, {
        title: title.trim() || undefined,
        topic: topic.trim() || undefined,
        visibility,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episode', id] });
      Alert.alert('Saved', 'Episode updated.');
      router.back();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update episode.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/episodes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.removeQueries({ queryKey: ['episode', id] });
      Alert.alert('Deleted', 'Episode has been deleted.');
      router.replace('/(tabs)');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete episode.');
    },
  });

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Episode',
      'This action cannot be undone. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  }, [deleteMutation]);

  if (isError) {
    return <ErrorState message="Failed to load episode" onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Edit Episode' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Edit Episode' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Episode title"
          placeholderTextColor={colors.textTertiary}
          maxLength={200}
          testID="episode-edit-title-input"
        />

        <Text style={styles.label}>Topic</Text>
        <TextInput
          style={[styles.input, styles.topicInput]}
          value={topic}
          onChangeText={setTopic}
          placeholder="What is this episode about?"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={5000}
          testID="episode-edit-topic-input"
        />

        <Text style={styles.label}>Visibility</Text>
        <View style={styles.visibilityRow}>
          {VISIBILITY_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[
                styles.visibilityChip,
                visibility === opt.value && styles.visibilityChipActive,
              ]}
              onPress={() => setVisibility(opt.value)}
              testID={`episode-edit-visibility-${opt.value.toLowerCase()}`}
            >
              <Ionicons
                name={opt.icon as keyof typeof Ionicons.glyphMap}
                size={16}
                color={
                  visibility === opt.value
                    ? colors.textInverse
                    : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.visibilityChipText,
                  visibility === opt.value && styles.visibilityChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[
            styles.saveButton,
            saveMutation.isPending && styles.saveButtonDisabled,
          ]}
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          testID="episode-edit-save-button"
        >
          {saveMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.deleteButton}
          onPress={handleDelete}
          disabled={deleteMutation.isPending}
          testID="episode-edit-delete-button"
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
          <Text style={styles.deleteButtonText}>Delete Episode</Text>
        </Pressable>
      </ScrollView>
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
  scrollContent: {
    padding: spacing.lg,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
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
    marginBottom: spacing.lg,
  },
  topicInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  visibilityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visibilityChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  visibilityChipText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  visibilityChipTextActive: {
    color: colors.textInverse,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
});
