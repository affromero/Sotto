import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../../lib/api';

type Step = 'name' | 'interests' | 'done';

interface Tag {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  children?: Tag[];
}

export default function OnboardingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const { data: tagsData } = useQuery<{ tags: Tag[] }>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await api.get('/tags');
      return res.data;
    },
    enabled: step === 'interests',
  });

  const nameMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/users/me', { name: name.trim() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      setStep('interests');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to save name.');
    },
  });

  const interestsMutation = useMutation({
    mutationFn: async () => {
      await api.post('/onboarding/interests', {
        tagIds: selectedTagIds,
        customTags: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      setStep('done');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to save interests.');
    },
  });

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : prev.length < 20
          ? [...prev, tagId]
          : prev,
    );
  }, []);

  const handleFinish = useCallback(() => {
    router.replace('/(tabs)');
  }, [router]);

  // Group tags: top-level categories with children
  const categories = (tagsData?.tags ?? []).filter((t) => !t.parentId);
  const subTags = (tagsData?.tags ?? []).filter((t) => t.parentId);
  const tagsByParent = new Map<string, Tag[]>();
  for (const tag of subTags) {
    const arr = tagsByParent.get(tag.parentId!) ?? [];
    arr.push(tag);
    tagsByParent.set(tag.parentId!, arr);
  }

  if (step === 'name') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.heading}>Welcome to Sotto</Text>
          <Text style={styles.subheading}>What should we call you?</Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textTertiary}
            maxLength={50}
            autoFocus
            testID="onboarding-name-input"
          />

          <Pressable
            style={[
              styles.primaryButton,
              (!name.trim() || nameMutation.isPending) &&
                styles.primaryButtonDisabled,
            ]}
            onPress={() => nameMutation.mutate()}
            disabled={!name.trim() || nameMutation.isPending}
            testID="onboarding-name-continue"
          >
            {nameMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (step === 'interests') {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.heading}>Pick your interests</Text>
          <Text style={styles.subheading}>
            Select topics to personalize your feed ({selectedTagIds.length}/20)
          </Text>

          {categories.map((cat) => {
            const children = tagsByParent.get(cat.id) ?? [];
            if (children.length === 0) return null;
            return (
              <View key={cat.id} style={styles.categoryBlock}>
                <Text style={styles.categoryName}>{cat.name}</Text>
                <View style={styles.chipGrid}>
                  {children.map((tag, tagIndex) => {
                    const isSelected = selectedTagIds.includes(tag.id);
                    return (
                      <Pressable
                        key={tag.id}
                        testID={`onboarding-interest-chip-${tagIndex}`}
                        style={[
                          styles.chip,
                          isSelected && styles.chipSelected,
                        ]}
                        onPress={() => toggleTag(tag.id)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            isSelected && styles.chipTextSelected,
                          ]}
                        >
                          {tag.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}

          <Pressable
            style={[
              styles.primaryButton,
              interestsMutation.isPending && styles.primaryButtonDisabled,
            ]}
            onPress={() => interestsMutation.mutate()}
            disabled={interestsMutation.isPending}
            testID="onboarding-interests-continue"
          >
            {interestsMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {selectedTagIds.length > 0
                  ? `Continue (${selectedTagIds.length} selected)`
                  : 'Skip'}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // step === 'done'
  return (
    <View style={styles.doneContainer}>
      <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
      <Text style={styles.doneHeading}>You're all set!</Text>
      <Text style={styles.doneSubheading}>
        Start exploring podcasts or create your first one.
      </Text>
      <Pressable style={styles.primaryButton} onPress={handleFinish} testID="onboarding-done-button">
        <Text style={styles.primaryButtonText}>Let's Go</Text>
      </Pressable>
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
    paddingTop: spacing.xl * 2,
  },
  heading: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  input: {
    fontFamily: typography.fontBody,
    fontSize: 18,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  categoryBlock: {
    marginBottom: spacing.lg,
  },
  categoryName: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.textInverse,
  },
  doneContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  doneHeading: {
    fontFamily: typography.fontHeading,
    fontSize: 28,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  doneSubheading: {
    fontFamily: typography.fontBody,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
});
