/**
 * components/learn/ListeningSection.tsx
 *
 * Listening section: expo-audio player for the podcast audio above the
 * comprehension MC questions (reuses MCSection logic inline).
 * Gracefully handles null audioUrl with a plain note.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { ClassSectionData } from '../../lib/learn-api';
import { MCSection } from './MCSection';

// ---------------------------------------------------------------------------
// Sub-component: podcast audio player
// ---------------------------------------------------------------------------

function PodcastPlayer({ audioUrl }: { audioUrl: string }) {
  const player = useAudioPlayer(audioUrl);
  const status = useAudioPlayerStatus(player);

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress =
    status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View style={styles.player}>
      <Pressable
        onPress={togglePlayback}
        style={({ pressed }) => [
          styles.playBtn,
          pressed && styles.playBtnPressed,
        ]}
        accessibilityLabel={status.playing ? 'Pause lesson audio' : 'Play lesson audio'}
        accessibilityRole="button"
      >
        <Text style={styles.playBtnIcon}>{status.playing ? '⏸' : '▶'}</Text>
      </Pressable>

      <View style={styles.playerInfo}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(status.currentTime)}</Text>
          <Text style={styles.timeText}>
            {status.duration > 0 ? formatTime(status.duration) : '--:--'}
          </Text>
        </View>
      </View>

      {status.isBuffering && (
        <Text style={styles.bufferingText}>Buffering…</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ListeningSectionProps {
  section: ClassSectionData;
  answers: Record<string, number>;
  onSelect: (questionId: string, index: number) => void;
  submitted: boolean;
  result: { score: number; passed: boolean } | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ListeningSection({
  section,
  answers,
  onSelect,
  submitted,
  result,
}: ListeningSectionProps) {
  const audioUrl = section.podcast?.audioUrl ?? null;

  return (
    <View style={styles.container}>
      {/* Audio player */}
      <View style={styles.audioBlock}>
        <Text style={styles.audioLabel}>Lesson Audio</Text>
        {audioUrl ? (
          <PodcastPlayer audioUrl={audioUrl} />
        ) : (
          <View style={styles.noAudio}>
            <Text style={styles.noAudioText}>
              Audio is not available for this lesson yet.
            </Text>
          </View>
        )}
        {section.podcast?.title && (
          <Text style={styles.podcastTitle} numberOfLines={2}>
            {section.podcast.title}
          </Text>
        )}
      </View>

      {/* Comprehension questions */}
      {section.questions.length > 0 && (
        <View style={styles.questionsBlock}>
          <Text style={styles.questionsLabel}>Comprehension Questions</Text>
          <MCSection
            section={section}
            answers={answers}
            onSelect={onSelect}
            submitted={submitted}
            result={result}
          />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  audioBlock: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  audioLabel: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playBtnPressed: {
    opacity: 0.75,
  },
  playBtnIcon: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  playerInfo: {
    flex: 1,
    gap: 4,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.textTertiary,
  },
  bufferingText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
  },
  podcastTitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  noAudio: {
    paddingVertical: spacing.sm,
  },
  noAudioText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  questionsBlock: {
    gap: spacing.sm,
  },
  questionsLabel: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
