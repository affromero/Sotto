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

export default function PodcastEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: podcast, isLoading, isError, refetch } = useQuery<{
    id: string;
    title: string;
    topic: string | null;
    visibility: Visibility;
    user: { id: string };
  }>({
    queryKey: ['podcast', id],
    queryFn: async () => {
      const res = await api.get(`/podcasts/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [initialized, setInitialized] = useState(false);

  if (podcast && !initialized) {
    setTitle(podcast.title ?? '');
    setTopic(podcast.topic ?? '');
    setVisibility(podcast.visibility ?? 'PUBLIC');
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/podcasts/${id}`, {
        title: title.trim() || undefined,
        topic: topic.trim() || undefined,
        visibility,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', id] });
      Alert.alert('Saved', 'Podcast updated.');
      router.back();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update podcast.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/podcasts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      queryClient.removeQueries({ queryKey: ['podcast', id] });
      Alert.alert('Deleted', 'Podcast has been deleted.');
      router.replace('/(tabs)');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete podcast.');
    },
  });

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Podcast',
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
    return <ErrorState message="Failed to load podcast" onRetry={refetch} />;
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Edit Podcast' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Edit Podcast' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Podcast title"
          placeholderTextColor={colors.textTertiary}
          maxLength={200}
          testID="podcast-edit-title-input"
        />

        <Text style={styles.label}>Topic</Text>
        <TextInput
          style={[styles.input, styles.topicInput]}
          value={topic}
          onChangeText={setTopic}
          placeholder="What is this podcast about?"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={5000}
          testID="podcast-edit-topic-input"
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
              testID={`podcast-edit-visibility-${opt.value.toLowerCase()}`}
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
          testID="podcast-edit-save-button"
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
          testID="podcast-edit-delete-button"
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
          <Text style={styles.deleteButtonText}>Delete Podcast</Text>
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
