/**
 * components/learn/SpeakingExercise.tsx
 *
 * Per-prompt speaking practice:
 *   1. Show targetPhrase + translation (+ ipa)
 *   2. Play referenceTtsUrl via expo-audio
 *   3. Record with useAudioRecorder (expo-audio)
 *   4. Upload via uploadSpeaking, poll pollSpeaking until SCORED/FAILED
 *   5. Show overallScore + rubric + feedback
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { uploadSpeaking, pollSpeaking, type ClassPrompt, type SpeakingScore } from '../../lib/learn-api';

// ---------------------------------------------------------------------------
// Reference audio player
// ---------------------------------------------------------------------------

function ReferencePlayer({ url }: { url: string }) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [player, status.playing]);

  return (
    <Pressable
      style={styles.refPlayBtn}
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={status.playing ? 'Pause reference audio' : 'Play reference audio'}
    >
      <Ionicons
        name={status.playing ? 'pause-circle' : 'play-circle'}
        size={20}
        color={colors.accent}
      />
      <Text style={styles.refPlayBtnText}>
        {status.playing ? 'Pause reference' : 'Hear reference'}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Score display
// ---------------------------------------------------------------------------

function ScoreCard({ score }: { score: SpeakingScore }) {
  return (
    <View style={styles.scoreCard}>
      <Text style={styles.scoreHeading}>
        Score: {score.overallScore != null ? `${Math.round(score.overallScore)}%` : '—'}
      </Text>
      {score.rubricScores && (
        <View style={styles.rubricRow}>
          {Object.entries(score.rubricScores).map(([key, val]) => (
            <View key={key} style={styles.rubricItem}>
              <Text style={styles.rubricLabel}>{key}</Text>
              <Text style={styles.rubricValue}>{Math.round(val as number)}%</Text>
            </View>
          ))}
        </View>
      )}
      {score.transcript && (
        <Text style={styles.transcriptText}>"{score.transcript}"</Text>
      )}
      {score.feedback && (
        <Text style={styles.feedbackText}>{score.feedback}</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Single prompt card with record/upload/poll logic
// ---------------------------------------------------------------------------

type PromptStatus = 'idle' | 'recording' | 'uploading' | 'polling' | 'scored' | 'failed';

function PromptCard({ classId, prompt }: { classId: string; prompt: ClassPrompt }) {
  const [promptStatus, setPromptStatus] = useState<PromptStatus>('idle');
  const [score, setScore] = useState<SpeakingScore | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Microphone access is needed for speaking practice.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPromptStatus('recording');
    } catch {
      Alert.alert('Error', 'Could not start recording. Please try again.');
    }
  }, [recorder]);

  const stopAndUpload = useCallback(async () => {
    try {
      setPromptStatus('uploading');
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording URI');

      const { recordingId: rid } = await uploadSpeaking(classId, prompt.id, uri);
      setRecordingId(rid);
      setPromptStatus('polling');

      // Poll until terminal state
      let attempts = 0;
      const MAX_ATTEMPTS = 30;
      const INTERVAL_MS = 2000;

      const poll = async (): Promise<void> => {
        if (attempts >= MAX_ATTEMPTS) {
          setPromptStatus('failed');
          return;
        }
        attempts += 1;
        const result = await pollSpeaking(classId, prompt.id, rid);
        if (result.status === 'SCORED') {
          setScore(result);
          setPromptStatus('scored');
        } else if (result.status === 'FAILED') {
          setPromptStatus('failed');
        } else {
          await new Promise<void>((res) => setTimeout(res, INTERVAL_MS));
          await poll();
        }
      };

      await poll();
    } catch {
      setPromptStatus('failed');
    }
  }, [classId, prompt.id, recorder]);

  const retry = useCallback(() => {
    setPromptStatus('idle');
    setScore(null);
    setRecordingId(null);
  }, []);

  const durationSeconds = Math.round(recorderState.durationMillis / 1000);

  return (
    <View style={styles.promptCard}>
      {/* Phrase */}
      <Text style={styles.targetPhrase}>{prompt.targetPhrase}</Text>
      <Text style={styles.translationText}>{prompt.translation}</Text>
      {prompt.ipa ? <Text style={styles.ipaText}>[{prompt.ipa}]</Text> : null}

      {/* Reference audio */}
      {prompt.referenceTtsUrl ? (
        <ReferencePlayer url={prompt.referenceTtsUrl} />
      ) : null}

      {/* Recording controls */}
      {promptStatus === 'idle' && (
        <Pressable
          style={styles.recordBtn}
          onPress={startRecording}
          accessibilityRole="button"
          accessibilityLabel="Start recording"
        >
          <Ionicons name="mic" size={20} color={colors.textInverse} />
          <Text style={styles.recordBtnText}>Record</Text>
        </Pressable>
      )}

      {promptStatus === 'recording' && (
        <View style={styles.recordingRow}>
          <View style={styles.recordingIndicator} />
          <Text style={styles.recordingTimer}>{durationSeconds}s</Text>
          <Pressable
            style={styles.stopBtn}
            onPress={stopAndUpload}
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
          >
            <Ionicons name="stop" size={18} color={colors.textInverse} />
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        </View>
      )}

      {(promptStatus === 'uploading' || promptStatus === 'polling') && (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.statusText}>
            {promptStatus === 'uploading' ? 'Uploading...' : 'Grading...'}
          </Text>
        </View>
      )}

      {promptStatus === 'scored' && score && (
        <>
          <ScoreCard score={score} />
          <Pressable style={styles.retryBtn} onPress={retry} accessibilityRole="button">
            <Ionicons name="refresh" size={16} color={colors.primary} />
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </>
      )}

      {promptStatus === 'failed' && (
        <View style={styles.failedRow}>
          <Text style={styles.failedText}>Grading failed.</Text>
          <Pressable style={styles.retryBtn} onPress={retry} accessibilityRole="button">
            <Ionicons name="refresh" size={16} color={colors.primary} />
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {/* Suppress unused variable warning */}
      {recordingId ? null : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SpeakingExerciseProps {
  classId: string;
  prompts: ClassPrompt[];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SpeakingExercise({ classId, prompts }: SpeakingExerciseProps) {
  if (prompts.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No speaking prompts for this section.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {prompts.map((p) => (
        <PromptCard key={p.id} classId={classId} prompt={p} />
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyContainer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
  promptCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  targetPhrase: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    lineHeight: 30,
  },
  translationText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  ipaText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  refPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  refPlayBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.accent,
    fontWeight: '500',
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
  },
  recordBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordingIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
  recordingTimer: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  stopBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },
  scoreCard: {
    backgroundColor: colors.successLighter,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.successLight,
  },
  scoreHeading: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '700',
    color: colors.success,
  },
  rubricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  rubricItem: {
    alignItems: 'center',
  },
  rubricLabel: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  rubricValue: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  transcriptText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  feedbackText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  failedRow: {
    gap: spacing.xs,
  },
  failedText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.error,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  retryBtnText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
});
