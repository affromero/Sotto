/**
 * app/learn/placement.tsx
 *
 * Language-pair selector → PlacementQuiz → redirect to /learn on completion.
 */

import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { PlacementQuiz } from '../../components/learn/PlacementQuiz';

// ---------------------------------------------------------------------------
// Language pair options
// ---------------------------------------------------------------------------

interface PairOption {
  pair: string;
  label: string;
  flag: string;
}

const PAIR_OPTIONS: PairOption[] = [
  { pair: 'DE_FROM_EN', label: 'German (from English)', flag: '🇩🇪' },
  { pair: 'EN_FROM_ES', label: 'English (from Spanish)', flag: '🇺🇸' },
  { pair: 'ES_FROM_EN', label: 'Spanish (from English)', flag: '🇪🇸' },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function PlacementScreen() {
  const router = useRouter();
  const [selectedPair, setSelectedPair] = useState<string | null>(null);

  const handleComplete = () => {
    router.replace('/learn');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ title: 'Placement Test', headerBackTitle: 'Back' }} />

      {selectedPair == null ? (
        <View style={styles.selectorContainer}>
          <Text style={styles.heading}>Choose a language</Text>
          <Text style={styles.subheading}>
            Select the language pair you want to learn.
          </Text>

          {PAIR_OPTIONS.map((opt) => (
            <Pressable
              key={opt.pair}
              style={({ pressed }) => [
                styles.pairCard,
                pressed && styles.pairCardPressed,
              ]}
              onPress={() => setSelectedPair(opt.pair)}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
            >
              <Text style={styles.pairFlag}>{opt.flag}</Text>
              <Text style={styles.pairLabel}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <PlacementQuiz pair={selectedPair} onComplete={handleComplete} />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  selectorContainer: {
    flex: 1,
    padding: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  heading: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subheading: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  pairCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 64,
  },
  pairCardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  pairFlag: {
    fontSize: 32,
  },
  pairLabel: {
    fontFamily: typography.fontBody,
    fontSize: 17,
    color: colors.textPrimary,
    fontWeight: '500',
    flex: 1,
  },
});
