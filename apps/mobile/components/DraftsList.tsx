import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { shadowSm } from '../lib/shadows';

interface Draft {
  id: string;
  title: string | null;
  topic: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  onResume: (draftId: string) => void;
}

export function DraftsList({ onResume }: Props) {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ drafts: Draft[] }>({
    queryKey: ['drafts'],
    queryFn: async () => {
      const res = await api.get('/drafts');
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (draftId: string) => {
      await api.delete(`/drafts/${draftId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete draft.');
    },
  });

  const handleDelete = useCallback(
    (draftId: string) => {
      Alert.alert('Delete Draft', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(draftId),
        },
      ]);
    },
    [deleteMutation],
  );

  const drafts = data?.drafts ?? [];
  if (drafts.length === 0) return null;

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Resume a Draft</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {drafts.map((draft, index) => (
          <Pressable
            key={draft.id}
            style={styles.card}
            onPress={() => onResume(draft.id)}
            testID={`draft-item-${index}`}
          >
            <View style={styles.cardHeader}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              <Pressable
                onPress={() => handleDelete(draft.id)}
                hitSlop={8}
                testID={`draft-delete-${index}`}
              >
                <Ionicons name="close" size={16} color={colors.textTertiary} />
              </Pressable>
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {draft.title || draft.topic || 'Untitled draft'}
            </Text>
            <Text style={styles.cardTime}>{timeAgo(draft.updatedAt)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  scrollContent: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  card: {
    width: 160,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadowSm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  cardTime: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
