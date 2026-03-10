import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { BottomSheet } from './BottomSheet';
import { api } from '../lib/api';

interface ForkModalProps {
  visible: boolean;
  onClose: () => void;
  podcastId: string;
  podcastTitle: string;
}

export function ForkModal({ visible, onClose, podcastId, podcastTitle }: ForkModalProps) {
  const router = useRouter();
  const [remixNote, setRemixNote] = useState('');

  const forkMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/podcasts/${podcastId}/fork`, {
        remixNote: remixNote.trim() || undefined,
      });
      return res.data as { id: string };
    },
    onSuccess: (data) => {
      setRemixNote('');
      onClose();
      router.push(`/podcast/${data.id}`);
    },
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Fork Podcast">
      <View style={styles.wrapper}>
        <Text style={styles.description}>
          Create your own remix of &quot;{podcastTitle}&quot;
        </Text>

        <Text style={styles.label}>Remix Note</Text>
        <TextInput
          style={styles.input}
          value={remixNote}
          onChangeText={setRemixNote}
          placeholder="What's your angle? (optional)"
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={280}
        />

        <Pressable
          style={[styles.forkButton, forkMutation.isPending && styles.forkButtonDisabled]}
          onPress={() => forkMutation.mutate()}
          disabled={forkMutation.isPending}
        >
          {forkMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <View style={styles.forkButtonContent}>
              <Ionicons name="git-branch-outline" size={18} color={colors.textInverse} />
              <Text style={styles.forkButtonText}>Fork It</Text>
            </View>
          )}
        </Pressable>

        {forkMutation.isError && (
          <Text style={styles.errorText}>Failed to fork podcast. Please try again.</Text>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingBottom: spacing.md,
  },
  description: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
  },
  forkButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  forkButtonDisabled: {
    opacity: 0.6,
  },
  forkButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  forkButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
