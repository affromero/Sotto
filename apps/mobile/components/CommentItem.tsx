import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@sotto/shared';
import { Avatar } from './Avatar';
import { timeAgo } from '../lib/formatters';

export interface CommentData {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    handle: string | null;
    image: string | null;
  };
  replies: CommentData[];
}

interface CommentItemProps {
  comment: CommentData;
  currentUserId: string | undefined;
  onReply: (parentId: string) => void;
  onDelete: (commentId: string) => void;
  depth?: number;
}

export function CommentItem({
  comment,
  currentUserId,
  onReply,
  onDelete,
  depth = 0,
}: CommentItemProps) {
  const isOwn = currentUserId === comment.user?.id;

  return (
    <View style={[styles.container, depth > 0 && styles.nested]} testID={`comment-item-${comment.id}`}>
      <View style={styles.row}>
        <Avatar uri={comment.user?.image} name={comment.user?.name} size={32} />
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.name}>{comment.user?.name ?? 'Anonymous'}</Text>
            <Text style={styles.time}>{timeAgo(comment.createdAt)}</Text>
          </View>
          <Text style={styles.text}>{comment.content}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => onReply(comment.id)}
              hitSlop={8}
              style={styles.actionButton}
              testID={`comment-reply-${comment.id}`}
              accessibilityLabel="Reply"
              accessibilityRole="button"
            >
              <Ionicons name="chatbubble-outline" size={14} color={colors.textTertiary} />
              <Text style={styles.actionText}>Reply</Text>
            </Pressable>
            {isOwn && (
              <Pressable
                onPress={() => onDelete(comment.id)}
                hitSlop={8}
                style={styles.actionButton}
                testID={`comment-delete-${comment.id}`}
                accessibilityLabel="Delete comment"
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={14} color={colors.error} />
                <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
      {comment.replies?.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          currentUserId={currentUserId}
          onReply={onReply}
          onDelete={onDelete}
          depth={depth + 1}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  nested: {
    marginLeft: spacing.xl,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  name: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  time: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  text: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 21,
    marginBottom: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
  deleteText: {
    color: colors.error,
  },
});
