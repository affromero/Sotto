import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { VoiceTrackSummary } from '@sotto/shared';
import { BottomSheet } from './BottomSheet';
import { Avatar } from './Avatar';

interface VoiceTrackPickerProps {
  visible: boolean;
  onClose: () => void;
  voiceTracks: VoiceTrackSummary[];
  activeTrackId: string | null;
  onSelect: (track: VoiceTrackSummary) => void;
}

export function VoiceTrackPicker({
  visible,
  onClose,
  voiceTracks,
  activeTrackId,
  onSelect,
}: VoiceTrackPickerProps) {
  const readyTracks = voiceTracks.filter((t) => t.status === 'READY');

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Voice Tracks">
      <View style={styles.wrapper}>
        {readyTracks.length === 0 ? (
          <Text style={styles.emptyText}>No voice tracks available.</Text>
        ) : (
          readyTracks.map((track) => {
            const isActive = track.id === activeTrackId;
            return (
              <Pressable
                key={track.id}
                style={[styles.trackRow, isActive && styles.trackRowActive]}
                onPress={() => onSelect(track)}
                accessibilityLabel={`Voice track: ${track.name}`}
                accessibilityRole="button"
              >
                <View style={styles.trackInfo}>
                  {track.contributor ? (
                    <Avatar
                      uri={track.contributor.image}
                      name={track.contributor.name}
                      size={32}
                    />
                  ) : (
                    <View style={styles.defaultAvatar}>
                      <Ionicons name="mic-outline" size={16} color={colors.primary} />
                    </View>
                  )}
                  <View style={styles.trackText}>
                    <Text style={styles.trackName}>{track.name}</Text>
                    <Text style={styles.trackMeta}>
                      {track.ttsProvider ?? 'Default'}
                      {track.contributor
                        ? ` · by ${track.contributor.name ?? 'Unknown'}`
                        : ''}
                    </Text>
                  </View>
                </View>
                {isActive && (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                )}
              </Pressable>
            );
          })
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingBottom: spacing.md,
  },
  emptyText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  trackRowActive: {
    backgroundColor: colors.primaryLighter,
  },
  trackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  defaultAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackText: {
    flex: 1,
  },
  trackName: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  trackMeta: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
});
