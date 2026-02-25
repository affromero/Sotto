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
    speakers?: Array<Speaker>;
  }) => void;
  speakers?: Array<Speaker>;
  /** Maximum speakers allowed by the user's tier (2 = FREE, 4 = PRO). */
  maxSpeakers?: number;
}

// Speaker presets use UPPERCASE names to match TTS provider convention.
const SPEAKER_PRESETS: Record<number, Speaker[]> = {
  1: [
    { name: 'HOST', description: 'Warm, engaging narrator who guides the listener through the topic with energy and clarity. Speaks in first person, uses rhetorical questions, personal anecdotes, and vivid storytelling.' },
  ],
  2: [
    { name: 'HOST', description: 'Warm, curious, asks great questions, guides the conversation. Represents the listener. Reacts naturally — laughs, expresses surprise, interjects.' },
    { name: 'EXPERT', description: 'Knowledgeable, vivid storyteller, uses analogies, examples, and occasionally humor. Explains complex topics in ways that create "aha" moments.' },
  ],
  3: [
    { name: 'HOST', description: 'Warm, curious moderator who keeps the conversation flowing and asks clarifying questions.' },
    { name: 'EXPERT', description: 'Deep domain knowledge, explains concepts clearly, backs claims with evidence and examples.' },
    { name: 'GUEST', description: "Brings a fresh, opinionated real-world perspective that challenges or extends the Expert's view." },
  ],
  4: [
    { name: 'HOST', description: 'Warm moderator who guides the discussion and ensures all voices are heard.' },
    { name: 'EXPERT', description: 'Knowledgeable, data-driven, explains complex ideas with clarity and precision.' },
    { name: 'GUEST', description: 'Practical real-world experience and a fresh perspective that enriches the discussion.' },
    { name: 'SKEPTIC', description: 'Challenges assumptions, plays devil\'s advocate, asks the tough "but why?" questions.' },
  ],
};

const FORMAT_OPTIONS: Array<{ count: 1 | 2 | 3 | 4; label: string }> = [
  { count: 1, label: 'Solo' },
  { count: 2, label: 'Dialogue' },
  { count: 3, label: 'Panel' },
  { count: 4, label: 'Roundtable' },
];

export function VoicePickerSheet({
  onSelectionChange,
  maxSpeakers = 2,
}: VoicePickerSheetProps) {
  const [speakerCount, setSpeakerCount] = useState<1 | 2 | 3 | 4>(
    Math.min(2, maxSpeakers) as 1 | 2 | 3 | 4
  );
  const activeSpeakers = SPEAKER_PRESETS[speakerCount] ?? SPEAKER_PRESETS[2];

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
      onSelectionChange({ voices: undefined, speakers: activeSpeakers });
      return;
    }
    const voices = Array.from(selectedVoices.entries()).map(([s, v]) => ({
      speaker: s,
      voiceId: v,
    }));
    onSelectionChange({
      voices: voices.length > 0 ? voices : undefined,
      speakers: activeSpeakers,
    });
  }, [isCustom, selectedVoices, activeSpeakers, onSelectionChange]);

  function handleSpeakerCountChange(count: 1 | 2 | 3 | 4) {
    if (count > maxSpeakers) return;
    setSpeakerCount(count);
    setSelectedVoices(new Map());
  }

  const handleVoiceSelect = useCallback(
    (speaker: string, voiceId: string) => {
      setSelectedVoices((prev) => {
        const next = new Map(prev);
        next.set(speaker, voiceId);
        return next;
      });
    },
    [],
  );

  const speakerColor = (name: string) => {
    const upper = name.toUpperCase();
    if (upper === 'HOST' || upper === 'GUEST') return colors.speakerHost;
    return colors.speakerExpert;
  };

  return (
    <View>
      {/* Format picker */}
      <View style={styles.formatRow}>
        <Text style={styles.formatLabel}>Format</Text>
        <View style={styles.formatPills}>
          {FORMAT_OPTIONS.map(({ count, label }) => {
            const locked = count > maxSpeakers;
            const active = speakerCount === count;
            return (
              <Pressable
                key={count}
                style={[
                  styles.formatPill,
                  active && styles.formatPillActive,
                  locked && styles.formatPillLocked,
                ]}
                onPress={() => handleSpeakerCountChange(count)}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={`${label}${locked ? ' (PRO)' : ''}`}
                accessibilityState={{ selected: active, disabled: locked }}
              >
                <Text
                  style={[
                    styles.formatPillText,
                    active && styles.formatPillTextActive,
                  ]}
                >
                  {label}
                </Text>
                {locked && (
                  <View style={styles.proBadge}>
                    <Text style={styles.proBadgeText}>PRO</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        style={[styles.autoCard, !isCustom && styles.autoCardSelected]}
        onPress={() => setIsCustom(false)}
        accessibilityRole="button"
        accessibilityLabel="Auto-assign voices"
        accessibilityState={{ selected: !isCustom }}
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
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
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
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  formatLabel: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  formatPills: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  formatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 32,
  },
  formatPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLighter,
  },
  formatPillLocked: {
    opacity: 0.55,
  },
  formatPillText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  formatPillTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  proBadge: {
    backgroundColor: colors.accent ?? '#1E3A5F',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  proBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
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
