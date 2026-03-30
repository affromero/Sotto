import { View, Text, Pressable, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, typography, borderRadius } from '@sotto/shared';
import type { PodcastSummary } from '@sotto/shared';
import { api } from '../lib/api';
import { getPodcastGradient } from '../lib/gradients';
import { shadowMd } from '../lib/shadows';
import { Avatar } from './Avatar';

const CARD_WIDTH = Dimensions.get('window').width * 0.78;

export function FeaturedCarousel() {
  const router = useRouter();

  const { data } = useQuery<{ podcasts: PodcastSummary[] }>({
    queryKey: ['feed', 'featured'],
    queryFn: async () => {
      const res = await api.get('/feed', {
        params: { sort: 'trending', limit: 3 },
      });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const podcasts = data?.podcasts ?? [];
  if (podcasts.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Featured</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + spacing.md}
      >
        {podcasts.map((podcast) => {
          const gradient = getPodcastGradient(podcast.id);
          return (
            <Pressable
              key={podcast.id}
              style={styles.card}
              onPress={() => router.push(`/podcast/${podcast.id}`)}
              accessibilityLabel={`Featured: ${podcast.title}`}
              accessibilityRole="button"
            >
              <LinearGradient
                colors={gradient.colors}
                start={gradient.start}
                end={gradient.end}
                style={styles.cardGradient}
              >
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.5)']}
                  style={styles.scrim}
                />
                <View style={styles.cardHeader}>
                  <Avatar
                    uri={podcast.user?.image}
                    name={podcast.user?.name}
                    size={28}
                  />
                  <Text style={styles.creatorName} numberOfLines={1}>
                    {podcast.user?.name ?? 'Unknown'}
                  </Text>
                </View>
                <View style={styles.cardBottom}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {podcast.title}
                  </Text>
                  <Text style={styles.cardTopic} numberOfLines={1}>
                    {podcast.topic}
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadowMd,
  },
  cardGradient: {
    height: 160,
    justifyContent: 'space-between',
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '70%',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm + 2,
    gap: spacing.xs,
  },
  creatorName: {
    fontFamily: typography.fontBody,
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    flex: 1,
  },
  cardBottom: {
    padding: spacing.sm + 2,
    zIndex: 1,
  },
  cardTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 18,
    color: '#FFFFFF',
    lineHeight: 24,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: 2,
  },
  cardTopic: {
    fontFamily: typography.fontBody,
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
});
