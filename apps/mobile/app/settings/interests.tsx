import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';
import { ErrorState } from '../../components/ErrorState';

interface Category {
  id: string;
  name: string;
  slug: string;
}

export default function InterestsScreen() {
  const [selected, setSelected] = useState<string[]>([]);

  const { data, isLoading, isError, refetch } = useQuery<{ tags: Category[] }>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await api.get('/tags');
      return res.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.post('/onboarding/interests', { interests: selected });
    },
    onSuccess: () => {
      Alert.alert('Saved', 'Interests updated!');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to save interests.');
    },
  });

  const toggleCategory = useCallback((slug: string) => {
    setSelected((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug],
    );
  }, []);

  const categories = data?.tags ?? [];

  if (isError) {
    return <ErrorState message="Failed to load" onRetry={refetch} />;
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Interests' }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.description}>
          Select topics you're interested in to personalize your feed.
        </Text>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <View style={styles.grid}>
            {categories.map((cat) => {
              const isSelected = selected.includes(cat.slug);
              return (
                <Pressable
                  key={cat.id}
                  style={[styles.chip, isSelected && styles.chipSelected]}
                  onPress={() => toggleCategory(cat.slug)}
                  testID={`interests-chip-${cat.slug}`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {cat.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable
          style={[
            styles.saveButton,
            (selected.length === 0 || saveMutation.isPending) &&
              styles.saveButtonDisabled,
          ]}
          onPress={() => saveMutation.mutate()}
          disabled={selected.length === 0 || saveMutation.isPending}
          testID="interests-save-button"
        >
          {saveMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.saveButtonText}>
              Save ({selected.length} selected)
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  description: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  chip: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.textInverse,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
