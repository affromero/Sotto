import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { CommentItem } from './CommentItem';
import type { CommentData } from './CommentItem';

interface CommentSectionProps {
  podcastId: string;
  commentCount: number;
}

export function CommentSection({ podcastId, commentCount }: CommentSectionProps) {
  const queryClient = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);

  const currentUser = queryClient.getQueryData<{ id: string }>(['user', 'me']);

  const { data, isLoading } = useQuery<{ comments: CommentData[] }>({
    queryKey: ['podcast', podcastId, 'comments'],
    queryFn: async () => {
      const res = await api.get(`/podcasts/${podcastId}/comments`);
      return res.data;
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/podcasts/${podcastId}/comments`, {
        content: newComment.trim(),
        parentId: replyToId,
      });
    },
    onSuccess: () => {
      setNewComment('');
      setReplyToId(null);
      queryClient.invalidateQueries({
        queryKey: ['podcast', podcastId, 'comments'],
      });
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
    },
    onError: () => { Alert.alert('Error', 'Could not post comment.'); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await api.delete(`/podcasts/${podcastId}/comments/${commentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['podcast', podcastId, 'comments'],
      });
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId] });
    },
    onError: () => { Alert.alert('Error', 'Could not delete comment.'); },
  });

  const handleReply = useCallback((parentId: string) => {
    setReplyToId(parentId);
  }, []);

  const handleDelete = useCallback(
    (commentId: string) => {
      Alert.alert('Delete Comment', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(commentId),
        },
      ]);
    },
    [deleteMutation],
  );

  const comments = data?.comments ?? [];

  return (
    <View style={styles.container} testID="comments-section">
      <View style={styles.header}>
        <Text style={styles.title}>Comments</Text>
        <Text style={styles.count}>{commentCount}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={colors.primary}
          style={styles.loader}
        />
      ) : comments.length === 0 ? (
        <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
      ) : (
        comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            currentUserId={currentUser?.id}
            onReply={handleReply}
            onDelete={handleDelete}
          />
        ))
      )}

      {/* Comment Input */}
      <View style={styles.inputRow}>
        {replyToId && (
          <View style={styles.replyIndicator}>
            <Text style={styles.replyText}>Replying to comment</Text>
            <Pressable onPress={() => setReplyToId(null)} hitSlop={8}>
              <Ionicons name="close" size={14} color={colors.textTertiary} />
            </Pressable>
          </View>
        )}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={newComment}
            onChangeText={setNewComment}
            placeholder="Add a comment..."
            placeholderTextColor={colors.textTertiary}
            maxLength={500}
            testID="comment-input"
          />
          <Pressable
            onPress={() => addMutation.mutate()}
            disabled={!newComment.trim() || addMutation.isPending}
            style={[
              styles.sendButton,
              (!newComment.trim() || addMutation.isPending) &&
                styles.sendButtonDisabled,
            ]}
            testID="comment-send-button"
            accessibilityLabel="Send comment"
            accessibilityRole="button"
          >
            {addMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Ionicons name="arrow-up" size={18} color={colors.textInverse} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  count: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
  },
  loader: {
    marginVertical: spacing.lg,
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    marginVertical: spacing.lg,
  },
  inputRow: {
    marginTop: spacing.md,
  },
  replyIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryLighter,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  replyText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
