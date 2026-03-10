import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { shadowSm } from '../../lib/shadows';

interface VoiceClone {
  id: string;
  name: string;
  provider: string;
  verificationStatus: string;
  sampleUrl: string | null;
  salesCount?: number;
  totalEarningsCents?: number;
}

export default function VoiceManagementScreen() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{
    userClones: VoiceClone[];
    maxVoiceClones: number;
  }>({
    queryKey: ['voices', 'mine'],
    queryFn: async () => {
      const res = await api.get('/voices');
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (voiceCloneId: string) => {
      await api.delete('/voices/clone', { data: { voiceCloneId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voices'] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to delete voice clone.');
    },
  });

  const handleDelete = useCallback(
    (voice: VoiceClone) => {
      Alert.alert(
        'Delete Voice Clone',
        `Are you sure you want to delete "${voice.name}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteMutation.mutate(voice.id),
          },
        ],
      );
    },
    [deleteMutation],
  );

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'VERIFIED':
      case 'ADMIN_VERIFIED':
        return { name: 'checkmark-circle' as const, color: colors.success };
      case 'PENDING_VERIFICATION':
        return { name: 'time-outline' as const, color: colors.warning };
      case 'REJECTED':
        return { name: 'close-circle' as const, color: colors.error };
      default:
        return { name: 'help-circle-outline' as const, color: colors.textTertiary };
    }
  };

  const clones = data?.userClones ?? [];
  const maxClones = data?.maxVoiceClones ?? 5;

  const renderItem = useCallback(
    ({ item }: { item: VoiceClone }) => {
      const status = getStatusIcon(item.verificationStatus);
      return (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardLeft}>
              <Ionicons name="mic" size={20} color={colors.primary} />
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.name}</Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.cardProvider}>{item.provider}</Text>
                  <View style={styles.statusBadge}>
                    <Ionicons name={status.name} size={14} color={status.color} />
                    <Text style={[styles.statusText, { color: status.color }]}>
                      {item.verificationStatus.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
            <Pressable onPress={() => handleDelete(item)} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </Pressable>
          </View>
        </View>
      );
    },
    [handleDelete],
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Voice Clones' }} />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={clones}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.countLabel}>
              {clones.length} of {maxClones} voice clones used
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="mic-off-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyText}>No voice clones yet</Text>
              <Text style={styles.emptySubtext}>
                Clone your voice from the web app to use in podcasts.
              </Text>
            </View>
          }
        />
      )}
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
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  countLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
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
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  cardInfo: {
    flex: 1,
  },
  cardName: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  cardProvider: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    textTransform: 'capitalize',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.md,
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textTertiary,
  },
  emptySubtext: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.xl,
  },
});
