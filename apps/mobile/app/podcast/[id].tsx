import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackPlayer, { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { colors, spacing, typography, borderRadius, getContentBadgeLabel } from '@sotto/shared';
import type { PodcastDetail, SegmentData } from '@sotto/shared';
import { api } from '../../lib/api';
import { setupPlayer, loadTrack } from '../../lib/audio-player';
import { formatTime } from '../../lib/formatters';

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2] as const;

function findCurrentSegmentIndex(
  segments: SegmentData[],
  positionSeconds: number,
): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.startTime !== null && positionSeconds >= seg.startTime) {
      return i;
    }
  }
  return 0;
}

export default function PodcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const transcriptRef = useRef<FlatList<SegmentData>>(null);

  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [speedIndex, setSpeedIndex] = useState(1); // default 1x
  const [questionModalVisible, setQuestionModalVisible] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [progressBarWidth, setProgressBarWidth] = useState(0);
  const [teleprompterEnabled, setTeleprompterEnabled] = useState(false);

  const { position, duration: trackDuration } = useProgress(250);
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;

  const {
    data: podcast,
    isLoading,
    error,
  } = useQuery<PodcastDetail>({
    queryKey: ['podcast', id],
    queryFn: async () => {
      const res = await api.get(`/podcasts/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  const likeMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/podcasts/${id}/like`);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['podcast', id] });
      const previous = queryClient.getQueryData<PodcastDetail>(['podcast', id]);
      if (previous) {
        queryClient.setQueryData<PodcastDetail>(['podcast', id], {
          ...previous,
          isLiked: !previous.isLiked,
          likeCount: previous.isLiked
            ? previous.likeCount - 1
            : previous.likeCount + 1,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['podcast', id], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['podcast', id] });
    },
  });

  const interactMutation = useMutation({
    mutationFn: async (payload: { question: string; timestamp: number }) => {
      const res = await api.post(`/podcasts/${id}/interact`, payload);
      return res.data as { id: string; answer: string };
    },
    onSuccess: (data) => {
      setQuestionModalVisible(false);
      setQuestionText('');
      Alert.alert('Answer', data.answer ?? 'Your question is being processed.');
      queryClient.invalidateQueries({ queryKey: ['podcast', id] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to submit your question. Please try again.');
    },
  });

  // Initialize player on mount
  useEffect(() => {
    setupPlayer()
      .then(() => setPlayerReady(true))
      .catch((err: Error) => {
        setPlayerError(err.message ?? 'Audio player failed to initialize');
        setPlayerReady(false);
      });
  }, []);

  // Load track when podcast data arrives and player is ready
  useEffect(() => {
    if (!playerReady || !podcast?.audioUrl) return;
    loadTrack(
      podcast.id,
      podcast.audioUrl,
      podcast.title,
      podcast.user?.name ?? 'Sotto',
    );
  }, [playerReady, podcast?.id, podcast?.audioUrl, podcast?.title, podcast?.user?.name]);

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }, [isPlaying]);

  const handleSkipForward = useCallback(async () => {
    const current = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(current.position + 15);
  }, []);

  const handleSkipBackward = useCallback(async () => {
    const current = await TrackPlayer.getProgress();
    await TrackPlayer.seekTo(Math.max(0, current.position - 15));
  }, []);

  const handleSpeedToggle = useCallback(async () => {
    const nextIndex = (speedIndex + 1) % PLAYBACK_SPEEDS.length;
    setSpeedIndex(nextIndex);
    await TrackPlayer.setRate(PLAYBACK_SPEEDS[nextIndex]);
  }, [speedIndex]);

  const handleSeek = useCallback(
    async (ratio: number) => {
      const totalDuration = podcast?.duration ?? trackDuration;
      if (totalDuration > 0) {
        await TrackPlayer.seekTo(ratio * totalDuration);
      }
    },
    [podcast?.duration, trackDuration],
  );

  const handleAskQuestion = useCallback(async () => {
    if (!questionText.trim()) return;
    await TrackPlayer.pause();
    interactMutation.mutate({
      question: questionText.trim(),
      timestamp: position,
    });
  }, [questionText, position, interactMutation]);

  const totalDuration = podcast?.duration ?? trackDuration;
  const progressRatio = totalDuration > 0 ? position / totalDuration : 0;
  const currentSegmentIndex = podcast?.segments
    ? findCurrentSegmentIndex(podcast.segments, position)
    : -1;

  // Auto-scroll transcript to current segment (teleprompter mode only)
  useEffect(() => {
    if (teleprompterEnabled && currentSegmentIndex >= 0 && isPlaying) {
      transcriptRef.current?.scrollToIndex({
        index: currentSegmentIndex,
        animated: true,
        viewPosition: 0.4,
      });
    }
  }, [teleprompterEnabled, currentSegmentIndex, isPlaying]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading podcast...</Text>
      </View>
    );
  }

  if (error || !podcast) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>Failed to load podcast</Text>
        <Text style={styles.errorSubtext}>Please check your connection and try again.</Text>
      </View>
    );
  }

  const listHeader = (
    <>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {podcast.title}
        </Text>
        <Text style={styles.creator}>
          {podcast.user?.name ?? 'Unknown Creator'}
        </Text>
        <View style={styles.podcastBadgeRow}>
          <View
            style={[
              styles.podcastContentBadge,
              podcast.source !== 'IMPORT' || !podcast.isHumanContent
                ? styles.podcastContentBadgeAi
                : styles.podcastContentBadgeHuman,
            ]}
          >
            <Text
              style={[
                styles.podcastContentBadgeText,
                podcast.source !== 'IMPORT' || !podcast.isHumanContent
                  ? styles.podcastContentBadgeTextAi
                  : styles.podcastContentBadgeTextHuman,
              ]}
            >
              {getContentBadgeLabel(podcast)}
            </Text>
          </View>
        </View>
        {totalDuration > 0 && (
          <Text style={styles.durationBadge}>
            {formatTime(totalDuration)}
          </Text>
        )}
      </View>

      {/* Player Controls */}
      <View style={styles.playerSection}>
        {/* Progress Bar */}
        <Pressable
          style={styles.progressContainer}
          onLayout={(e) => setProgressBarWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (progressBarWidth <= 0) return;
            const ratio = e.nativeEvent.locationX / progressBarWidth;
            if (ratio >= 0 && ratio <= 1) {
              handleSeek(ratio);
            }
          }}
          accessibilityRole="adjustable"
          accessibilityLabel={`Playback progress: ${formatTime(position)} of ${formatTime(totalDuration)}`}
        >
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(progressRatio * 100, 100)}%` },
              ]}
            />
            <View
              style={[
                styles.progressThumb,
                { left: `${Math.min(progressRatio * 100, 100)}%` },
              ]}
            />
          </View>
        </Pressable>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Text style={styles.timeText}>{formatTime(totalDuration)}</Text>
        </View>

        {/* Transport Controls */}
        <View style={styles.controls}>
          <Pressable
            onPress={handleSkipBackward}
            style={styles.skipButton}
            accessibilityLabel="Skip backward 15 seconds"
            accessibilityRole="button"
          >
            <Text style={styles.skipText}>-15</Text>
          </Pressable>

          <Pressable
            onPress={handlePlayPause}
            style={styles.playButton}
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            accessibilityRole="button"
          >
            <Text style={styles.playIcon}>{isPlaying ? '\u275A\u275A' : '\u25B6'}</Text>
          </Pressable>

          <Pressable
            onPress={handleSkipForward}
            style={styles.skipButton}
            accessibilityLabel="Skip forward 15 seconds"
            accessibilityRole="button"
          >
            <Text style={styles.skipText}>+15</Text>
          </Pressable>
        </View>

        {/* Speed + Like Row */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleSpeedToggle}
            style={styles.speedButton}
            accessibilityLabel={`Playback speed: ${PLAYBACK_SPEEDS[speedIndex]}x`}
            accessibilityRole="button"
          >
            <Text style={styles.speedText}>
              {PLAYBACK_SPEEDS[speedIndex]}x
            </Text>
          </Pressable>

          <Pressable
            onPress={() => likeMutation.mutate()}
            style={styles.likeButton}
            accessibilityLabel={podcast.isLiked ? 'Unlike podcast' : 'Like podcast'}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.likeIcon,
                podcast.isLiked && styles.likeIconActive,
              ]}
            >
              {podcast.isLiked ? '\u2665' : '\u2661'}
            </Text>
            <Text style={styles.likeCount}>{podcast.likeCount}</Text>
          </Pressable>
        </View>
      </View>

      {/* Player Error */}
      {playerError && (
        <View style={styles.playerErrorContainer}>
          <Text style={styles.playerErrorText}>
            Audio unavailable: {playerError}
          </Text>
        </View>
      )}

      {/* Transcript Header with Teleprompter Toggle */}
      <View style={styles.transcriptHeader}>
        <Text style={styles.transcriptTitle}>Transcript</Text>
        <Pressable
          onPress={() => setTeleprompterEnabled((prev) => !prev)}
          style={[
            styles.teleprompterToggle,
            teleprompterEnabled && styles.teleprompterToggleActive,
          ]}
          accessibilityLabel={`Teleprompter: ${teleprompterEnabled ? 'on' : 'off'}`}
          accessibilityRole="switch"
        >
          <Text
            style={[
              styles.teleprompterToggleText,
              teleprompterEnabled && styles.teleprompterToggleTextActive,
            ]}
          >
            Teleprompter
          </Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />

      <FlatList<SegmentData>
        ref={transcriptRef}
        data={podcast.segments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.transcriptContent,
          { paddingBottom: Math.max(100, insets.bottom + 80) },
        ]}
        ListHeaderComponent={listHeader}
        onScrollToIndexFailed={() => {
          // Silently handle scroll failures for segments not yet rendered
        }}
        renderItem={({ item, index }) => {
          const isCurrent = index === currentSegmentIndex;
          const isDimmed = teleprompterEnabled && !isCurrent;
          const speakerPalette = colors.speakers;
          const allSpeakers: string[] = [];
          for (const seg of segments) {
            if (!allSpeakers.includes(seg.speaker)) allSpeakers.push(seg.speaker);
          }
          const speakerIdx = Math.max(0, allSpeakers.indexOf(item.speaker)) % speakerPalette.length;
          const speakerColor = speakerPalette[speakerIdx];
          return (
            <View
              style={[
                styles.segmentRow,
                isCurrent && styles.segmentRowActive,
                isDimmed && styles.segmentRowDimmed,
              ]}
              accessibilityLabel={`${item.speaker} says: ${item.text}`}
            >
              <View
                style={[
                  styles.speakerBadge,
                  { backgroundColor: speakerColor.bg },
                ]}
              >
                <Text
                  style={[
                    styles.speakerLabel,
                    { color: speakerColor.color },
                  ]}
                >
                  {item.speaker}
                </Text>
              </View>
              <Text
                style={[
                  styles.segmentText,
                  isCurrent && styles.segmentTextActive,
                  isDimmed && styles.segmentTextDimmed,
                ]}
              >
                {item.text}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.emptyTranscript}>No transcript available.</Text>
        }
      />

      {/* Ask a Question FAB */}
      <Pressable
        onPress={() => setQuestionModalVisible(true)}
        style={[
          styles.askButton,
          { bottom: Math.max(spacing.lg, insets.bottom + spacing.sm) },
        ]}
        accessibilityLabel="Ask a question about this podcast"
        accessibilityRole="button"
      >
        <Text style={styles.askButtonText}>Ask a Question</Text>
      </Pressable>

      {/* Question Modal */}
      <Modal
        visible={questionModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setQuestionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ask a Question</Text>
            <Text style={styles.modalSubtitle}>
              at {formatTime(position)}
            </Text>
            <TextInput
              style={styles.questionInput}
              value={questionText}
              onChangeText={setQuestionText}
              placeholder="What would you like to know?"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={500}
              autoFocus
              accessibilityLabel="Question input"
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setQuestionModalVisible(false);
                  setQuestionText('');
                }}
                style={styles.cancelButton}
                accessibilityLabel="Cancel"
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAskQuestion}
                style={[
                  styles.submitButton,
                  (!questionText.trim() || interactMutation.isPending) &&
                    styles.submitButtonDisabled,
                ]}
                disabled={!questionText.trim() || interactMutation.isPending}
                accessibilityLabel="Submit question"
                accessibilityRole="button"
              >
                {interactMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.submitButtonText}>Submit</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorIcon: {
    fontFamily: typography.fontHeading,
    fontSize: 48,
    color: colors.error,
    width: 72,
    height: 72,
    lineHeight: 72,
    textAlign: 'center',
    backgroundColor: colors.errorLight,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  errorText: {
    fontFamily: typography.fontHeading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  errorSubtext: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 24,
    color: colors.textPrimary,
    lineHeight: 32,
  },
  creator: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  podcastBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  podcastContentBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  podcastContentBadgeAi: {
    backgroundColor: colors.primaryLighter,
  },
  podcastContentBadgeHuman: {
    backgroundColor: colors.successLighter,
  },
  podcastContentBadgeText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
  },
  podcastContentBadgeTextAi: {
    color: colors.primary,
  },
  podcastContentBadgeTextHuman: {
    color: colors.success,
  },
  durationBadge: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },

  // Player
  playerSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  progressContainer: {
    paddingVertical: spacing.sm,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    position: 'relative',
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  progressThumb: {
    position: 'absolute',
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    marginLeft: -7,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  timeText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textTertiary,
  },

  // Transport
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    gap: spacing.xl,
  },
  skipButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  playIcon: {
    fontSize: 28,
    color: colors.textInverse,
    marginLeft: 2,
  },

  // Speed + Like
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  speedButton: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  speedText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
  },
  likeIcon: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  likeIconActive: {
    color: colors.error,
  },
  likeCount: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textSecondary,
  },

  // Transcript
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  transcriptTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  teleprompterToggle: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  teleprompterToggleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  teleprompterToggleText: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  teleprompterToggleTextActive: {
    color: colors.textInverse,
  },
  transcriptContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  segmentRow: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  segmentRowActive: {
    backgroundColor: colors.primaryLighter,
  },
  speakerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  // Speaker badge colors applied dynamically via colors.speakers[index]
  speakerLabel: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Speaker label colors applied dynamically via colors.speakers[index]
  segmentText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  segmentTextActive: {
    color: colors.textPrimary,
    fontWeight: '500',
    fontSize: 17,
    lineHeight: 26,
  },
  segmentRowDimmed: {
    opacity: 0.35,
  },
  segmentTextDimmed: {
    color: colors.textTertiary,
  },
  emptyTranscript: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },

  // Player Error
  playerErrorContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningLighter,
  },
  playerErrorText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.warning,
    textAlign: 'center',
  },

  // Ask FAB
  askButton: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm + 6,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  askButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  modalTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  questionInput: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelButton: {
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  submitButton: {
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    minWidth: 100,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
