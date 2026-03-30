import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { ReferenceData } from '@sotto/shared';
import { api } from '../lib/api';
import { ErrorState } from './ErrorState';
import { ReferencesTab } from './ReferencesTab';

interface ScriptPreviewProps {
  podcastId: string;
  onApprove: () => void;
  onRegenerate: () => void;
  onEdit?: (turns: Turn[]) => void;
}

interface Turn {
  speaker: string;
  text: string;
  direction?: string;
}

interface ScriptResponse {
  turns: Turn[];
  references: ReferenceData[];
  version: number;
}

function getSpeakerColor(speaker: string, uniqueSpeakers: string[]): string {
  if (speaker.includes('Host') || speaker === uniqueSpeakers[0]) {
    return colors.speakerHost;
  }
  return colors.speakerExpert;
}

function TurnRow({ turn, uniqueSpeakers }: { turn: Turn; uniqueSpeakers: string[] }) {
  const speakerColor = getSpeakerColor(turn.speaker, uniqueSpeakers);

  return (
    <View style={styles.turnRow}>
      <View style={styles.speakerRow}>
        <View style={[styles.speakerDot, { backgroundColor: speakerColor }]} />
        <Text style={[styles.speakerLabel, { color: speakerColor }]}>
          {turn.speaker.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.turnText}>{turn.text}</Text>
      {turn.direction && (
        <Text style={styles.turnDirection}>{turn.direction}</Text>
      )}
    </View>
  );
}

export function ScriptPreview({ podcastId, onApprove, onRegenerate, onEdit }: ScriptPreviewProps) {
  const [refsExpanded, setRefsExpanded] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<ScriptResponse>({
    queryKey: ['podcast-script', podcastId],
    queryFn: async () => {
      const res = await api.get(`/podcasts/${podcastId}/script`);
      return res.data;
    },
  });

  const uniqueSpeakers = useMemo(() => {
    if (!data?.turns) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const turn of data.turns) {
      if (!seen.has(turn.speaker)) {
        seen.add(turn.speaker);
        result.push(turn.speaker);
      }
    }
    return result;
  }, [data?.turns]);

  const stats = useMemo(() => {
    if (!data?.turns) return { wordCount: 0, minutes: 0, turnCount: 0 };
    const wordCount = data.turns.reduce(
      (sum, turn) => sum + turn.text.split(/\s+/).filter(Boolean).length,
      0,
    );
    return {
      wordCount,
      minutes: Math.round(wordCount / 150),
      turnCount: data.turns.length,
    };
  }, [data?.turns]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load script'}
        onRetry={() => refetch()}
      />
    );
  }

  const handleRegenerate = () => {
    Alert.alert(
      'Regenerate Script?',
      'This will discard the current script and generate a new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Regenerate', style: 'destructive', onPress: onRegenerate },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.wordCount.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Words</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.minutes}</Text>
          <Text style={styles.statLabel}>Minutes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.turnCount}</Text>
          <Text style={styles.statLabel}>Turns</Text>
        </View>
      </View>

      <FlatList
        data={data?.turns ?? []}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => (
          <TurnRow turn={item} uniqueSpeakers={uniqueSpeakers} />
        )}
        style={styles.list}
        ListFooterComponent={
          data?.references && data.references.length > 0 ? (
            <View style={styles.refsSection}>
              <Pressable
                style={styles.refsHeader}
                onPress={() => setRefsExpanded(!refsExpanded)}
                accessibilityRole="button"
                accessibilityLabel={`References (${data.references.length})`}
                accessibilityState={{ expanded: refsExpanded }}
              >
                <Text style={styles.refsHeaderText}>
                  References ({data.references.length})
                </Text>
                <Ionicons
                  name={refsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
              {refsExpanded && <ReferencesTab references={data.references} />}
            </View>
          ) : null
        }
      />

      <View style={styles.footer}>
        <Pressable style={styles.secondaryButton} onPress={handleRegenerate} testID="script-regenerate-button">
          <Text style={styles.secondaryButtonText}>Regenerate</Text>
        </Pressable>
        {onEdit && data?.turns && (
          <Pressable style={styles.secondaryButton} onPress={() => onEdit(data.turns)}>
            <Text style={styles.secondaryButtonText}>Edit</Text>
          </Pressable>
        )}
        <Pressable style={styles.primaryButton} onPress={onApprove} testID="script-approve-button">
          <Text style={styles.primaryButtonText}>Generate Audio</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: typography.fontBody,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    alignSelf: 'stretch',
  },
  list: {
    flex: 1,
  },
  turnRow: {
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speakerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  speakerLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  turnText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    marginTop: 4,
  },
  turnDirection: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
  refsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  refsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  refsHeaderText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
