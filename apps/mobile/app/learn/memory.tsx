/**
 * app/learn/memory.tsx
 *
 * Vocabulary + grammar memory graph for a course.
 * Reads courseId from search params, fetches graph, renders MemoryGraphWebView.
 */

import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, typography } from '@sotto/shared';
import { fetchGraph, type MemoryGraphData } from '../../lib/learn-api';
import { MemoryGraphWebView } from '../../components/learn/MemoryGraphWebView';

export default function MemoryScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();

  const { data: graph, isLoading, isError } = useQuery<MemoryGraphData>({
    queryKey: ['graph', courseId],
    queryFn: () => {
      if (!courseId) throw new Error('Missing courseId');
      return fetchGraph(courseId);
    },
    enabled: !!courseId,
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Memory Graph', headerBackTitle: 'Back' }} />

      {isLoading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Building your graph...</Text>
        </View>
      )}

      {isError && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load your memory graph.</Text>
        </View>
      )}

      {graph && <MemoryGraphWebView graph={graph} />}
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
    gap: spacing.sm,
    padding: spacing.xl,
  },
  loadingText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
  },
  errorText: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.error,
    textAlign: 'center',
  },
});
