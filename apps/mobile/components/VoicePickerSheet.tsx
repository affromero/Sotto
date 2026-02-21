import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Switch,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';

interface Voice {
  id: string;
  name: string;
  gender: string;
  accent: string;
  ageRange: string;
  character: string;
}

interface Speaker {
  name: string;
  description: string;
}

interface VoicePickerSheetProps {
  onSelectionChange: (selection: {
    voices?: Array<{ speaker: string; voiceId: string }>;
  }) => void;
  speakers?: Array<Speaker>;
}

const DEFAULT_SPEAKERS: Speaker[] = [
  { name: 'Host', description: 'Main narrator' },
  { name: 'Expert', description: 'Subject matter expert' },
];

export function VoicePickerSheet({
  onSelectionChange,
  speakers,
}: VoicePickerSheetProps) {
  const activeSpeakers = speakers ?? DEFAULT_SPEAKERS;
  const [isCustom, setIsCustom] = useState(false);
  const [selectedVoices, setSelectedVoices] = useState<Map<string, string>>(
    new Map(),
  );

  const { data } = useQuery({
    queryKey: ['voices'],
    queryFn: async () => {
      const res = await api.get<{ voices: Voice[] }>('/voices');
      return res.data.voices;
    },
    enabled: isCustom,
  });

  useEffect(() => {
    if (!isCustom) {
      onSelectionChange({ voices: undefined });
    }
  }, [isCustom, onSelectionChange]);

  const handleVoiceSelect = useCallback(
    (speaker: string, voiceId: string) => {
      setSelectedVoices((prev) => {
        const next = new Map(prev);
        next.set(speaker, voiceId);
        const voices = Array.from(next.entries()).map(([s, v]) => ({
          speaker: s,
          voiceId: v,
        }));
        onSelectionChange({ voices });
        return next;
      });
    },
    [onSelectionChange],
  );

  const speakerColor = (name: string) =>
    name === 'Host' ? colors.speakerHost : colors.speakerExpert;

  return (
    <View>
      <Pressable
        style={[styles.autoCard, !isCustom && styles.autoCardSelected]}
        onPress={() => setIsCustom(false)}
      >
        <Text style={styles.autoIcon}>🎙️</Text>
        <Text style={styles.autoTitle}>Auto-assign voices</Text>
        <Text style={styles.autoDescription}>
          Each podcast gets a unique voice pair from our curated pool
        </Text>
      </Pressable>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Choose custom voices</Text>
        <Switch
          value={isCustom}
          onValueChange={setIsCustom}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>

      {isCustom &&
        data &&
        activeSpeakers.map((speaker) => (
          <View key={speaker.name} style={styles.speakerSection}>
            <Text
              style={[
                styles.speakerHeader,
                { color: speakerColor(speaker.name) },
              ]}
            >
              {speaker.name}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.voiceGrid}
            >
              {data.map((voice) => {
                const selected =
                  selectedVoices.get(speaker.name) === voice.id;
                return (
                  <Pressable
                    key={voice.id}
                    style={[
                      styles.voiceCard,
                      selected
                        ? styles.voiceCardSelected
                        : styles.voiceCardDefault,
                    ]}
                    onPress={() =>
                      handleVoiceSelect(speaker.name, voice.id)
                    }
                  >
                    <Text style={styles.voiceName}>{voice.name}</Text>
                    <Text style={styles.voiceAccent}>{voice.accent}</Text>
                    <Text style={styles.voiceCharacter} numberOfLines={2}>
                      {voice.character}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  autoCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    backgroundColor: colors.primaryLighter,
    borderWidth: 1,
    borderColor: colors.border,
  },
  autoCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  autoIcon: {
    fontSize: 24,
    marginBottom: spacing.xs,
  },
  autoTitle: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  autoDescription: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  toggleLabel: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  speakerSection: {
    marginBottom: spacing.md,
  },
  speakerHeader: {
    fontFamily: typography.fontHeading,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  voiceGrid: {
    gap: spacing.sm,
  },
  voiceCard: {
    width: 140,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
  },
  voiceCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLighter,
  },
  voiceCardDefault: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  voiceName: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  voiceAccent: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  voiceCharacter: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
