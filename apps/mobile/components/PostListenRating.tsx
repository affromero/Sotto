import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';

const DIMENSIONS = [
  { key: 'voiceNaturalness', label: 'Voice naturalness' },
  { key: 'contentAccuracy', label: 'Content accuracy' },
  { key: 'conversationFlow', label: 'Conversation flow' },
  { key: 'overallSatisfaction', label: 'Overall satisfaction' },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]['key'];

interface PostListenRatingProps {
  podcastId: string;
  onDismiss: () => void;
  completionPercent?: number;
}

export function PostListenRating({ podcastId, onDismiss, completionPercent }: PostListenRatingProps) {
  const [ratings, setRatings] = useState<Record<DimensionKey, number>>({
    voiceNaturalness: 0,
    contentAccuracy: 0,
    conversationFlow: 0,
    overallSatisfaction: 0,
  });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const allRated = DIMENSIONS.every((d) => ratings[d.key] > 0);

  function handleStarPress(key: DimensionKey, value: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRatings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!allRated) return;
    setSubmitting(true);
    try {
      await api.post(`/podcasts/${podcastId}/rating`, {
        ...ratings,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(completionPercent != null ? { completionPercent: Math.round(completionPercent * 10) / 10 } : {}),
      });
      setSubmitted(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(onDismiss, 2000);
    } catch {
      // Rating is non-critical — silent fail
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <View style={styles.root}>
        <Ionicons name="checkmark-circle" size={48} color={colors.success} />
        <Text style={styles.title}>Thanks for rating!</Text>
        <Text style={styles.subtitle}>Your feedback helps improve future podcasts.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Ionicons name="star-outline" size={32} color={colors.primary} />
      <Text style={styles.title}>How was this episode?</Text>
      <Text style={styles.subtitle}>Rate each aspect to help us improve.</Text>

      {DIMENSIONS.map((dim) => (
        <View key={dim.key} style={styles.dimensionRow}>
          <Text style={styles.dimensionLabel}>{dim.label}</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                key={star}
                onPress={() => handleStarPress(dim.key, star)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`${dim.label} ${star} stars`}
              >
                <Ionicons
                  name={star <= ratings[dim.key] ? 'star' : 'star-outline'}
                  size={28}
                  color={star <= ratings[dim.key] ? colors.primary : colors.border}
                />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <TextInput
        style={styles.commentInput}
        value={comment}
        onChangeText={setComment}
        placeholder="Any additional feedback? (optional)"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={500}
      />

      <Pressable
        style={[styles.submitButton, !allRated && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!allRated || submitting}
        accessibilityRole="button"
      >
        {submitting ? (
          <ActivityIndicator color={colors.textInverse} />
        ) : (
          <Text style={styles.submitButtonText}>Submit Rating</Text>
        )}
      </Pressable>

      <Pressable style={styles.skipButton} onPress={onDismiss} accessibilityRole="button">
        <Text style={styles.skipButtonText}>Skip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  dimensionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dimensionLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  commentInput: {
    width: '100%',
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    width: '100%',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  skipButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  skipButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
});
