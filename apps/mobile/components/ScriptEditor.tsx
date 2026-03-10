import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { BottomSheet } from './BottomSheet';

interface Turn {
  speaker: string;
  text: string;
  direction?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  podcastId: string;
  turns: Turn[];
}

export function ScriptEditor({ visible, onClose, podcastId, turns: initialTurns }: Props) {
  const queryClient = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.patch(`/podcasts/${podcastId}/script`, { turns });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', podcastId, 'script'] });
      Alert.alert('Saved', 'Script updated.');
      onClose();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to save script changes.');
    },
  });

  const handleStartEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditText(turns[index].text);
  }, [turns]);

  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null) return;
    const updated = [...turns];
    updated[editingIndex] = { ...updated[editingIndex], text: editText };
    setTurns(updated);
    setEditingIndex(null);
    setEditText('');
  }, [editingIndex, editText, turns]);

  const handleDeleteTurn = useCallback(
    (index: number) => {
      Alert.alert('Remove Turn', 'Delete this turn from the script?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const updated = turns.filter((_, i) => i !== index);
            setTurns(updated);
          },
        },
      ]);
    },
    [turns],
  );

  const getSpeakerColor = (speaker: string, index: number) => {
    const isHost = speaker.toLowerCase().includes('host') || index === 0;
    return isHost ? colors.speakerHost : colors.speakerExpert;
  };

  const renderTurn = useCallback(
    ({ item, index }: { item: Turn; index: number }) => {
      const isEditing = editingIndex === index;
      const speakerColor = getSpeakerColor(item.speaker, index);

      return (
        <View style={styles.turnCard}>
          <View style={styles.turnHeader}>
            <View style={styles.turnSpeaker}>
              <View style={[styles.speakerDot, { backgroundColor: speakerColor }]} />
              <Text style={styles.speakerName}>{item.speaker}</Text>
            </View>
            <View style={styles.turnActions}>
              <Pressable onPress={() => handleStartEdit(index)} hitSlop={6}>
                <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
              </Pressable>
              <Pressable onPress={() => handleDeleteTurn(index)} hitSlop={6}>
                <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
              </Pressable>
            </View>
          </View>

          {isEditing ? (
            <View style={styles.editContainer}>
              <TextInput
                style={styles.editInput}
                value={editText}
                onChangeText={setEditText}
                multiline
                autoFocus
              />
              <View style={styles.editButtons}>
                <Pressable
                  onPress={() => setEditingIndex(null)}
                  style={styles.editCancel}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSaveEdit} style={styles.editSave}>
                  <Text style={styles.editSaveText}>Done</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.turnText}>{item.text}</Text>
          )}

          {item.direction && !isEditing && (
            <Text style={styles.turnDirection}>{item.direction}</Text>
          )}
        </View>
      );
    },
    [editingIndex, editText, handleStartEdit, handleSaveEdit, handleDeleteTurn],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>Edit Script</Text>
        <Pressable
          style={[
            styles.saveButton,
            saveMutation.isPending && styles.saveButtonDisabled,
          ]}
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </Pressable>
      </View>

      <FlatList
        data={turns}
        keyExtractor={(_, index) => String(index)}
        renderItem={renderTurn}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  list: {
    maxHeight: 400,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  turnCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  turnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  turnSpeaker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  speakerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  speakerName: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  turnActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  turnText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  turnDirection: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  editContainer: {
    gap: spacing.sm,
  },
  editInput: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  editButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  editCancel: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  editCancelText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
  editSave: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  editSaveText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
