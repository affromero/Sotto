import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Share,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackPlayer, { useProgress, usePlaybackState, State } from 'react-native-track-player';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius, getContentBadgeLabel } from '@sotto/shared';
import { getPodcastGradient } from '../../lib/gradients';
import type { PodcastDetail, SegmentData } from '@sotto/shared';
import { PostListenQuiz } from '../../components/PostListenQuiz';
import { PostListenRating } from '../../components/PostListenRating';
import { api } from '../../lib/api';
import { setupPlayer, loadTrack } from '../../lib/audio-player';
import { formatTime } from '../../lib/formatters';
import { usePlaybackTelemetry } from '../../lib/usePlaybackTelemetry';
import type { PlaybackSnapshot } from '../../lib/usePlaybackTelemetry';
import { ForkModal } from '../../components/ForkModal';
import { CommentSection } from '../../components/CommentSection';
import { ReferencesTab } from '../../components/ReferencesTab';
import { VoiceTrackPicker } from '../../components/VoiceTrackPicker';
import { ForkLineage } from '../../components/ForkLineage';
import { VersionHistory } from '../../components/VersionHistory';
import { AddToCollectionSheet } from '../../components/AddToCollectionSheet';
import { usePlayerStore } from '../../lib/player-store';
import type { VoiceTrackSummary } from '@sotto/shared';

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
  const router = useRouter();
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
  const [forkModalVisible, setForkModalVisible] = useState(false);
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [versionHistoryVisible, setVersionHistoryVisible] = useState(false);
  const [collectionSheetVisible, setCollectionSheetVisible] = useState(false);
  const [activeVoiceTrackId, setActiveVoiceTrackId] = useState<string | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const playbackEndedRef = useRef(false);
  const setCurrentPodcast = usePlayerStore((s) => s.setCurrentPodcast);
  const lastSeekFromRef = useRef<number | undefined>(undefined);
  const interactionCountRef = useRef(0);

  // TrackPlayer hooks are safe — they return defaults when player isn't ready.
  // But wrap in try/catch at the usage sites to prevent native exceptions from crashing the app.
  const progress = useProgress(1000);
  const position = progress.position;
  const trackDuration = progress.duration;
  const playbackState = usePlaybackState();
  const isPlaying = playerReady && playbackState.state === State.Playing;

  // Detect playback completion → show rating first, then quiz
  useEffect(() => {
    if (
      !playbackEndedRef.current &&
      trackDuration > 0 &&
      position > 0 &&
      position >= trackDuration - 1 &&
      !isPlaying
    ) {
      playbackEndedRef.current = true;
      setShowRating(true);
    }
  }, [position, trackDuration, isPlaying]);

  // Animation values for player buttons
  const playScale = useSharedValue(1);
  const likeScale = useSharedValue(1);

  const playAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playScale.value }],
  }));

  const likeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  const saveScale = useSharedValue(1);
  const saveAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveScale.value }],
  }));

  // Question FAB pulse
  const fabScale = useSharedValue(1);
  useEffect(() => {
    fabScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.0, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [fabScale]);
  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabScale.value }],
  }));

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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (podcast?.isSaved) {
        await api.delete(`/podcasts/${id}/save`);
      } else {
        await api.post(`/podcasts/${id}/save`);
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['podcast', id] });
      const previous = queryClient.getQueryData<PodcastDetail>(['podcast', id]);
      if (previous) {
        queryClient.setQueryData<PodcastDetail>(['podcast', id], {
          ...previous,
          isSaved: !previous.isSaved,
          saveCount: previous.isSaved
            ? previous.saveCount - 1
            : previous.saveCount + 1,
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
      interactionCountRef.current++;
      incrementInteraction();
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
    ).catch(() => {});
    setCurrentPodcast({
      id: podcast.id,
      title: podcast.title,
      creator: podcast.user?.name ?? 'Sotto',
      audioUrl: podcast.audioUrl,
    });
  }, [playerReady, podcast?.id, podcast?.audioUrl, podcast?.title, podcast?.user?.name, setCurrentPodcast]);

  const handlePlayPause = useCallback(async () => {
    if (!playerReady) return;
    playScale.value = withSequence(
      withSpring(0.9, { damping: 15, stiffness: 400 }),
      withSpring(1.0, { damping: 10, stiffness: 200 }),
    );
    try {
      if (isPlaying) {
        await TrackPlayer.pause();
      } else {
        await TrackPlayer.play();
      }
    } catch {
      // Native player may be in a bad state — ignore rather than crash
    }
  }, [isPlaying, playScale, playerReady]);

  const handleSkipForward = useCallback(async () => {
    if (!playerReady) return;
    try {
      const current = await TrackPlayer.getProgress();
      lastSeekFromRef.current = current.position;
      await TrackPlayer.seekTo(current.position + 15);
    } catch {
      // Ignore native player errors
    }
  }, [playerReady]);

  const handleSkipBackward = useCallback(async () => {
    if (!playerReady) return;
    try {
      const current = await TrackPlayer.getProgress();
      lastSeekFromRef.current = current.position;
      await TrackPlayer.seekTo(Math.max(0, current.position - 15));
    } catch {
      // Ignore native player errors
    }
  }, [playerReady]);

  const handleSpeedToggle = useCallback(async () => {
    if (!playerReady) return;
    const nextIndex = (speedIndex + 1) % PLAYBACK_SPEEDS.length;
    setSpeedIndex(nextIndex);
    try {
      await TrackPlayer.setRate(PLAYBACK_SPEEDS[nextIndex]);
    } catch {
      // Ignore native player errors
    }
  }, [speedIndex, playerReady]);

  const handleSeek = useCallback(
    async (ratio: number) => {
      if (!playerReady) return;
      const totalDuration = podcast?.duration ?? trackDuration;
      if (totalDuration > 0) {
        lastSeekFromRef.current = position;
        try { await TrackPlayer.seekTo(ratio * totalDuration); } catch {}
      }
    },
    [podcast?.duration, trackDuration, position, playerReady],
  );

  const handleAskQuestion = useCallback(async () => {
    if (!questionText.trim()) return;
    try { await TrackPlayer.pause(); } catch {}
    interactMutation.mutate({
      question: questionText.trim(),
      timestamp: position,
    });
  }, [questionText, position, interactMutation]);

  const handleVoiceTrackSelect = useCallback(async (track: VoiceTrackSummary) => {
    if (!track.audioUrl) return;
    setActiveVoiceTrackId(track.id);
    setVoicePickerVisible(false);
    try {
      await loadTrack(
        podcast?.id ?? id,
        track.audioUrl,
        podcast?.title ?? '',
        track.contributor?.name ?? 'Sotto',
      );
    } catch {}
  }, [podcast?.id, podcast?.title, id]);

  const handleShare = useCallback(async () => {
    if (!podcast) return;
    try {
      await Share.share({
        message: `${podcast.title} — Listen on Sotto\nhttps://sotto.fm/podcast/${podcast.id}`,
        url: `https://sotto.fm/podcast/${podcast.id}`,
      });
    } catch {}
  }, [podcast]);

  // Playback telemetry
  const playbackSnapshot: PlaybackSnapshot = useMemo(() => ({
    podcastId: id,
    isPlaying,
    position,
    duration: podcast?.duration ?? trackDuration,
    playbackRate: PLAYBACK_SPEEDS[speedIndex],
    lastSeekFrom: lastSeekFromRef.current,
    interactionCount: interactionCountRef.current,
  }), [id, isPlaying, position, podcast?.duration, trackDuration, speedIndex]);

  const clearLastSeekFrom = useCallback(() => {
    lastSeekFromRef.current = undefined;
  }, []);

  const { incrementInteraction } = usePlaybackTelemetry(playbackSnapshot, clearLastSeekFrom);

  const totalDuration = podcast?.duration ?? trackDuration;
  const progressRatio = totalDuration > 0 ? position / totalDuration : 0;
  const currentSegmentIndex = podcast?.segments
    ? findCurrentSegmentIndex(podcast.segments ?? [], position)
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
      <View style={styles.centered} testID="generation-error">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>Failed to load podcast</Text>
        <Text style={styles.errorSubtext}>Please check your connection and try again.</Text>
        <Pressable
          style={styles.retryButton}
          onPress={() => queryClient.invalidateQueries({ queryKey: ['podcast', id] })}
          testID="generation-retry-button"
        >
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const currentUser = queryClient.getQueryData<{ id: string }>(['user', 'me']);
  const isOwner = currentUser?.id === podcast.user?.id;

  // Show failure details for owners when generation failed
  if (podcast.status === 'FAILED' && isOwner) {
    return (
      <View style={styles.centered} testID="generation-failed">
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorText}>Generation failed</Text>
        <Text style={styles.errorSubtext}>
          {podcast.failureReason ?? 'An unexpected error occurred during generation.'}
        </Text>
        <Pressable
          style={styles.retryButton}
          onPress={async () => {
            try {
              await api.post(`/podcasts/${id}/script/regenerate`);
              queryClient.invalidateQueries({ queryKey: ['podcast', id] });
              Alert.alert('Retrying', 'Script generation has been requeued.');
            } catch {
              Alert.alert('Error', 'Could not retry generation. Please try again later.');
            }
          }}
          testID="generation-retry-button"
        >
          <Text style={styles.retryButtonText}>Retry Generation</Text>
        </Pressable>
        <Pressable
          style={[styles.retryButton, styles.deleteButton]}
          onPress={() => {
            Alert.alert(
              'Delete Podcast',
              'This will permanently delete this podcast. Are you sure?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.delete(`/podcasts/${id}`);
                      router.back();
                    } catch {
                      Alert.alert('Error', 'Could not delete podcast.');
                    }
                  },
                },
              ],
            );
          }}
          testID="generation-delete-button"
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </Pressable>
      </View>
    );
  }

  const gradient = getPodcastGradient(podcast.id);

  const listHeader = (
    <>
      {/* Header with ambient gradient */}
      <View style={styles.header}>
        <LinearGradient
          colors={[gradient.colors[0] + '14', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ambientGradient}
        />
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
          testID="player-progress-bar"
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
            testID="player-skip-back"
          >
            <Ionicons name="play-back" size={24} color={colors.primary} />
          </Pressable>

          <Animated.View style={playAnimatedStyle}>
            <Pressable
              onPress={handlePlayPause}
              style={styles.playButton}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              accessibilityRole="button"
              testID="player-play-pause"
            >
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color={colors.textInverse} style={!isPlaying && styles.playIconOffset} />
            </Pressable>
          </Animated.View>

          <Pressable
            onPress={handleSkipForward}
            style={styles.skipButton}
            accessibilityLabel="Skip forward 15 seconds"
            accessibilityRole="button"
            testID="player-skip-forward"
          >
            <Ionicons name="play-forward" size={24} color={colors.primary} />
          </Pressable>
        </View>

        {/* Action Row: Speed + Social Icons */}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleSpeedToggle}
            style={styles.speedButton}
            accessibilityLabel={`Playback speed: ${PLAYBACK_SPEEDS[speedIndex]}x`}
            accessibilityRole="button"
            testID="player-speed-button"
          >
            <Text style={styles.speedText}>
              {PLAYBACK_SPEEDS[speedIndex]}x
            </Text>
          </Pressable>

          <View style={styles.actionIcons}>
            <Pressable
              onPress={() => {
                likeScale.value = withSequence(
                  withSpring(1.3, { damping: 8, stiffness: 400 }),
                  withSpring(1.0, { damping: 10, stiffness: 200 }),
                );
                likeMutation.mutate();
              }}
              style={styles.actionIcon}
              accessibilityLabel={podcast.isLiked ? 'Unlike podcast' : 'Like podcast'}
              accessibilityRole="button"
              testID="player-like-button"
            >
              <Animated.View style={likeAnimatedStyle}>
                <Ionicons
                  name={podcast.isLiked ? 'heart' : 'heart-outline'}
                  size={22}
                  color={podcast.isLiked ? colors.error : colors.textSecondary}
                />
              </Animated.View>
              {isOwner && <Text style={styles.actionCount}>{podcast.likeCount}</Text>}
            </Pressable>

            <Pressable
              onPress={() => {
                saveScale.value = withSequence(
                  withSpring(1.3, { damping: 8, stiffness: 400 }),
                  withSpring(1.0, { damping: 10, stiffness: 200 }),
                );
                saveMutation.mutate();
              }}
              onLongPress={() => setCollectionSheetVisible(true)}
              style={styles.actionIcon}
              accessibilityLabel={podcast.isSaved ? 'Unsave podcast' : 'Save podcast'}
              accessibilityHint="Long press to add to collection"
              accessibilityRole="button"
              testID="player-save-button"
            >
              <Animated.View style={saveAnimatedStyle}>
                <Ionicons
                  name={podcast.isSaved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={podcast.isSaved ? colors.primary : colors.textSecondary}
                />
              </Animated.View>
              {isOwner && <Text style={styles.actionCount}>{podcast.saveCount}</Text>}
            </Pressable>

            <Pressable
              onPress={handleShare}
              style={styles.actionIcon}
              accessibilityLabel="Share podcast"
              accessibilityRole="button"
              testID="player-share-button"
            >
              <Ionicons name="share-outline" size={22} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              onPress={() => setForkModalVisible(true)}
              style={styles.actionIcon}
              accessibilityLabel="Fork podcast"
              accessibilityRole="button"
              testID="player-fork-button"
            >
              <Ionicons name="git-branch-outline" size={22} color={colors.textSecondary} />
              {isOwner && podcast.forks?.length > 0 && (
                <Text style={styles.actionCount}>{podcast.forks?.length}</Text>
              )}
            </Pressable>

            {podcast.voiceTracks?.length > 1 && (
              <Pressable
                onPress={() => setVoicePickerVisible(true)}
                style={styles.actionIcon}
                accessibilityLabel="Voice tracks"
                accessibilityRole="button"
              >
                <Ionicons name="mic-outline" size={22} color={colors.textSecondary} />
              </Pressable>
            )}

            {podcast.versions?.length > 1 && (
              <Pressable
                onPress={() => setVersionHistoryVisible(true)}
                style={styles.actionIcon}
                accessibilityLabel="Version history"
                accessibilityRole="button"
              >
                <Ionicons name="time-outline" size={22} color={colors.textSecondary} />
              </Pressable>
            )}

            {isOwner && (
              <Pressable
                onPress={() => router.push(`/podcast/${podcast.id}/edit`)}
                style={styles.actionIcon}
                accessibilityLabel="Edit podcast"
                accessibilityRole="button"
                testID="player-edit-button"
              >
                <Ionicons name="create-outline" size={22} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
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
          testID="player-teleprompter-toggle"
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
        data={podcast.segments ?? []}
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
          for (const seg of podcast.segments ?? []) {
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
        ListFooterComponent={
          <>
            {podcast.references?.length > 0 && (
              <ReferencesTab references={podcast.references} />
            )}
            <ForkLineage
              podcastId={podcast.id}
              forkedFromId={podcast.forkedFromId}
              forkCount={podcast.forkCount}
            />
            <CommentSection
              podcastId={podcast.id}
              commentCount={podcast.commentCount}
            />
          </>
        }
        ListEmptyComponent={
          <Text style={styles.emptyTranscript}>No transcript available.</Text>
        }
      />

      {/* Ask a Question FAB */}
      <Animated.View style={[
        styles.askButton,
        { bottom: Math.max(spacing.lg, insets.bottom + spacing.sm) },
        fabAnimatedStyle,
      ]}>
        <Pressable
          onPress={() => setQuestionModalVisible(true)}
          style={styles.askButtonInner}
          accessibilityLabel="Ask a question about this podcast"
          accessibilityRole="button"
          testID="player-question-button"
        >
          <Text style={styles.askButtonText}>Ask a Question</Text>
        </Pressable>
      </Animated.View>

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
              testID="player-question-input"
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
                testID="player-question-cancel"
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
                testID="player-question-submit"
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

      <ForkModal
        visible={forkModalVisible}
        onClose={() => setForkModalVisible(false)}
        podcastId={podcast.id}
        podcastTitle={podcast.title}
      />

      <VoiceTrackPicker
        visible={voicePickerVisible}
        onClose={() => setVoicePickerVisible(false)}
        voiceTracks={podcast.voiceTracks}
        activeTrackId={activeVoiceTrackId ?? podcast.defaultVoiceTrackId}
        onSelect={handleVoiceTrackSelect}
      />

      <VersionHistory
        visible={versionHistoryVisible}
        onClose={() => setVersionHistoryVisible(false)}
        versions={podcast.versions}
        currentVersion={podcast.currentVersion}
      />

      <AddToCollectionSheet
        visible={collectionSheetVisible}
        onClose={() => setCollectionSheetVisible(false)}
        podcastId={podcast.id}
      />

      {/* Post-listen rating → then quiz */}
      <Modal
        visible={showRating}
        animationType="slide"
        transparent={false}
        onRequestClose={() => { setShowRating(false); setShowQuiz(true); }}
      >
        <View style={styles.quizModal}>
          <PostListenRating
            podcastId={podcast.id}
            completionPercent={trackDuration > 0 ? (position / trackDuration) * 100 : undefined}
            onDismiss={() => { setShowRating(false); setShowQuiz(true); }}
          />
        </View>
      </Modal>

      {/* Post-listen quiz */}
      <Modal
        visible={showQuiz}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowQuiz(false)}
      >
        <View style={styles.quizModal}>
          <PostListenQuiz
            podcastId={podcast.id}
            onDismiss={() => setShowQuiz(false)}
          />
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
  retryButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  retryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  deleteButton: {
    marginTop: spacing.sm,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  deleteButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.error ?? '#DC2626',
  },
  quizModal: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    position: 'relative',
    overflow: 'hidden',
  },
  ambientGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
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
  playIconOffset: {
    marginLeft: 3,
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
  actionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.xs + 2,
  },
  actionCount: {
    fontFamily: typography.fontBody,
    fontSize: 13,
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
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
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
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  askButtonInner: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
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
