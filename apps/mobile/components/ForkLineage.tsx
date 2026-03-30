import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { shadowSm } from '../lib/shadows';

interface LineageNode {
  id: string;
  title: string;
  user: { id: string; name: string | null; image: string | null };
  isCurrent?: boolean;
}

interface LineageResponse {
  parent: LineageNode | null;
  current: LineageNode;
  children: LineageNode[];
}

interface ForkLineageProps {
  podcastId: string;
  forkedFromId: string | null;
  forkCount: number;
}

export function ForkLineage({ podcastId, forkedFromId, forkCount }: ForkLineageProps) {
  const router = useRouter();

  const { data, isLoading } = useQuery<LineageResponse>({
    queryKey: ['podcast', podcastId, 'lineage'],
    queryFn: async () => {
      const res = await api.get(`/podcasts/${podcastId}/lineage`);
      return res.data;
    },
    enabled: forkedFromId !== null || forkCount > 0,
  });

  if (!forkedFromId && forkCount === 0) return null;
  if (isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="git-branch-outline" size={18} color={colors.textPrimary} />
        <Text style={styles.title}>Fork Lineage</Text>
      </View>

      {data.parent && (
        <Pressable
          style={styles.node}
          onPress={() => router.push(`/podcast/${data.parent!.id}`)}
        >
          <View style={styles.lineConnector} />
          <Avatar uri={data.parent.user?.image} name={data.parent.user?.name} size={28} />
          <View style={styles.nodeInfo}>
            <Text style={styles.nodeLabel}>Parent</Text>
            <Text style={styles.nodeTitle} numberOfLines={1}>{data.parent.title}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      )}

      <View style={[styles.node, styles.currentNode]}>
        <Avatar uri={data.current.user?.image} name={data.current.user?.name} size={28} />
        <View style={styles.nodeInfo}>
          <Text style={styles.nodeLabel}>Current</Text>
          <Text style={[styles.nodeTitle, styles.currentTitle]} numberOfLines={1}>
            {data.current.title}
          </Text>
        </View>
      </View>

      {data.children.map((child) => (
        <Pressable
          key={child.id}
          style={styles.node}
          onPress={() => router.push(`/podcast/${child.id}`)}
        >
          <View style={styles.lineConnector} />
          <Avatar uri={child.user?.image} name={child.user?.name} size={28} />
          <View style={styles.nodeInfo}>
            <Text style={styles.nodeLabel}>Fork</Text>
            <Text style={styles.nodeTitle} numberOfLines={1}>{child.title}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  loader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  node: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: borderRadius.md,
  },
  currentNode: {
    backgroundColor: colors.primaryLighter,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  lineConnector: {
    position: 'absolute',
    left: spacing.md + 14,
    top: -spacing.xs,
    width: 2,
    height: spacing.xs,
    backgroundColor: colors.border,
  },
  nodeInfo: {
    flex: 1,
  },
  nodeLabel: {
    fontFamily: typography.fontBody,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nodeTitle: {
    fontFamily: typography.fontBody,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 1,
  },
  currentTitle: {
    fontWeight: '600',
  },
});
