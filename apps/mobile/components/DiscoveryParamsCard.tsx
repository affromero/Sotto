import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { DiscoveryMetadata } from '@sotto/shared';
import { PillGroup } from './PillGroup';

const DEPTH_OPTIONS = [
  { value: 'eli5', label: 'ELI5' },
  { value: 'quick_overview', label: 'Quick Overview' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep_dive', label: 'Deep Dive' },
];

const TONE_OPTIONS = [
  { value: 'casual', label: 'Casual' },
  { value: 'professional', label: 'Professional' },
  { value: 'socratic', label: 'Socratic' },
  { value: 'comedic', label: 'Comedic' },
  { value: 'satirical', label: 'Satirical' },
  { value: 'storytelling', label: 'Storytelling' },
];

const AUDIENCE_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'expert', label: 'Expert' },
];

interface DiscoveryParamsCardProps {
  metadata: DiscoveryMetadata;
  onUpdate: (patch: Partial<DiscoveryMetadata>) => void;
}

export function DiscoveryParamsCard({ metadata, onUpdate }: DiscoveryParamsCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Podcast Settings</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Depth</Text>
        <PillGroup
          options={DEPTH_OPTIONS}
          selected={metadata.depth ?? 'standard'}
          onChange={(value) => onUpdate({ depth: value })}
          testIDPrefix="params-depth"
        />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Tone</Text>
        <PillGroup
          options={TONE_OPTIONS}
          selected={metadata.tone ?? 'casual'}
          onChange={(value) => onUpdate({ tone: value as DiscoveryMetadata['tone'] })}
          testIDPrefix="params-tone"
        />
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Audience</Text>
        <PillGroup
          options={AUDIENCE_OPTIONS}
          selected={metadata.audienceLevel ?? 'intermediate'}
          onChange={(value) => onUpdate({ audienceLevel: value })}
          testIDPrefix="params-audience"
        />
      </View>

      {metadata.focusAreas && metadata.focusAreas.length > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Focus</Text>
          <Text style={styles.focusText}>{metadata.focusAreas.join(', ')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  row: {
    marginBottom: spacing.sm,
  },
  label: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  focusText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textPrimary,
  },
});
