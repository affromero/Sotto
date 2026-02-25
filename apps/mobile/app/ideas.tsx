import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
} from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { EmptyState } from '../components/EmptyState';

const DELETE_THRESHOLD = -80;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SavedIdea {
  id: string;
  questionId: string;
  question: string;
  category: string;
  tagSlugs: string[];
  createdAt: string;
}

interface IdeasResponse {
  ideas: SavedIdea[];
}

function IdeaRow({
  idea,
  onTap,
  onDelete,
}: {
  idea: SavedIdea;
  onTap: () => void;
  onDelete: () => void;
}) {
  const translateX = useSharedValue(0);

  const handleDelete = useCallback(() => {
    onDelete();
  }, [onDelete]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, SCREEN_WIDTH])
    .onUpdate((event) => {
      if (event.translationX < 0) {
        translateX.value = event.translationX;
      }
    })
    .onEnd((event) => {
      if (event.translationX < DELETE_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 }, () => {
          runOnJS(handleDelete)();
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const deleteBackgroundStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [DELETE_THRESHOLD, 0], [1, 0], 'clamp'),
  }));

  const formattedDate = new Date(idea.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <View style={styles.rowWrapper}>
      <Animated.View style={[styles.deleteBackground, deleteBackgroundStyle]}>
        <Text style={styles.deleteText}>Delete</Text>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={rowStyle}>
          <Pressable
            style={({ pressed }) => [
              styles.ideaRow,
              pressed && styles.ideaRowPressed,
            ]}
            onPress={onTap}
          >
            <View style={styles.ideaContent}>
              <Text style={styles.ideaQuestion} numberOfLines={2}>
                {idea.question}
              </Text>
              <View style={styles.ideaMeta}>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{idea.category}</Text>
                </View>
                <Text style={styles.dateText}>{formattedDate}</Text>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function IdeasScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<IdeasResponse>({
    queryKey: ['ideas'],
    queryFn: async () => {
      const res = await api.get<IdeasResponse>('/ideas');
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ideaId: string) => {
      await api.delete(`/ideas/${ideaId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
    },
  });

  const ideas = data?.ideas ?? [];

  const handleTap = useCallback(
    (idea: SavedIdea) => {
      router.push(`/(tabs)/create?topic=${encodeURIComponent(idea.question)}`);
    },
    [router],
  );

  const handleDelete = useCallback(
    (idea: SavedIdea) => {
      Alert.alert('Delete Idea', `Remove "${idea.question}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(idea.id),
        },
      ]);
    },
    [deleteMutation],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedIdea }) => (
      <IdeaRow
        idea={item}
        onTap={() => handleTap(item)}
        onDelete={() => handleDelete(item)}
      />
    ),
    [handleTap, handleDelete],
  );

  const keyExtractor = useCallback((item: SavedIdea) => item.id, []);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Saved Ideas',
          headerBackTitle: 'Back',
        }}
      />
      <FlatList
        data={ideas}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : isError ? (
            <EmptyState
              title="Error"
              subtitle="Failed to load saved ideas"
            />
          ) : (
            <EmptyState
              icon={'\uD83D\uDD16'}
              title="No saved ideas yet"
              subtitle="Long press on quiz questions you'd like to explore later."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  rowWrapper: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    borderRadius: borderRadius.lg,
  },
  deleteBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.error,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: spacing.lg,
  },
  deleteText: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  ideaRow: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ideaRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  ideaContent: {
    padding: spacing.md,
  },
  ideaQuestion: {
    fontFamily: typography.fontHeading,
    fontSize: 17,
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  ideaMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryBadge: {
    backgroundColor: colors.accentLighter,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  categoryText: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    textTransform: 'uppercase',
  },
  dateText: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: colors.textTertiary,
  },
});
