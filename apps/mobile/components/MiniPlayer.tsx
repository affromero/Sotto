import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useProgress, usePlaybackState, State } from 'react-native-track-player';
import TrackPlayer from 'react-native-track-player';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { shadowMd } from '../lib/shadows';
import { usePlayerStore } from '../lib/player-store';

const MINI_PLAYER_HEIGHT = 60;
const TAB_BAR_HEIGHT = 49;

export { MINI_PLAYER_HEIGHT };

export function MiniPlayer() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const currentEpisode = usePlayerStore((s) => s.currentEpisode);
  const { position, duration } = useProgress(1000);
  const playbackState = usePlaybackState();
  const isPlaying = playbackState.state === State.Playing;

  // Hide on episode detail (already has full player) and auth screens
  if (!currentEpisode) return null;
  if (pathname.startsWith('/episode/') || pathname.startsWith('/auth/')) return null;

  const progressRatio = duration > 0 ? position / duration : 0;

  return (
    <Pressable
      style={[styles.container, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.sm }]}
      onPress={() => router.push(`/episode/${currentEpisode.id}`)}
      accessibilityLabel={`Now playing: ${currentEpisode.title}`}
      accessibilityRole="button"
      testID="mini-player"
    >
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(progressRatio * 100, 100)}%` },
          ]}
        />
      </View>

      <View style={styles.content}>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {currentEpisode.title}
          </Text>
          <Text style={styles.creator} numberOfLines={1}>
            {currentEpisode.creator}
          </Text>
        </View>

        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            if (isPlaying) {
              TrackPlayer.pause().catch(() => {});
            } else {
              TrackPlayer.play().catch(() => {});
            }
          }}
          style={styles.playButton}
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          accessibilityRole="button"
          hitSlop={8}
          testID="mini-player-play-pause"
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={22}
            color={colors.textPrimary}
          />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    height: MINI_PLAYER_HEIGHT,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowMd,
  },
  progressTrack: {
    height: 2,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  info: {
    flex: 1,
  },
  title: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  creator: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
