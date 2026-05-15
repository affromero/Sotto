import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = existsSync(resolve(process.cwd(), 'src'))
  ? process.cwd()
  : resolve(process.cwd(), 'apps/web');
const repoRoot = resolve(webRoot, '../..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), 'utf8');
}

describe('private-first OSS surfaces', () => {
  const primarySurfaceFiles = [
    'src/components/layout/Sidebar.tsx',
    'src/components/layout/MobileNav.tsx',
    'src/components/layout/TopBar.tsx',
    'src/components/layout/PublicNav.tsx',
    'src/components/layout/Footer.tsx',
    'src/components/landing/LandingNav.tsx',
    'src/components/landing/AuthCTA.tsx',
    'src/components/landing/chapters/ConvertChapter.tsx',
    'src/components/landing/chapters/JourneyChapter.tsx',
    'src/components/landing/JsonLd.tsx',
    'src/app/(dashboard)/dashboard/page.tsx',
    'src/app/(dashboard)/dashboard/DashboardStats.tsx',
    'src/app/(dashboard)/dashboard/MyPodcastsSection.tsx',
    'src/app/podcast/[podcastId]/PodcastPlayerView.tsx',
  ];

  it('does not link default product surfaces to the public feed or profile hub', () => {
    for (const file of primarySurfaceFiles) {
      const source = readSource(file);

      expect(source, file).not.toMatch(/\/feed(?:[?/"'`}]|$)/);
      expect(source, file).not.toMatch(/\/profile(?:[?/"'`}]|$)/);
      expect(source, file).not.toContain('Explore Feed');
      expect(source, file).not.toContain('Explore the Feed');
    }
  });

  it('does not describe the product as a social podcast network', () => {
    const landingSource = [
      'src/components/landing/chapters/ConvertChapter.tsx',
      'src/components/landing/chapters/JourneyChapter.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(landingSource).not.toContain('social podcast network');
    expect(landingSource).not.toContain('social feed');
    expect(landingSource).not.toContain('social features');
    expect(landingSource).not.toContain('Fork and remix any public podcast');
  });

  it('keeps dashboard data access scoped to private workspace metrics', () => {
    const dashboardSource = [
      'src/app/(dashboard)/dashboard/page.tsx',
      'src/app/(dashboard)/dashboard/DashboardStats.tsx',
      'src/app/(dashboard)/dashboard/MyPodcastsSection.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(dashboardSource).not.toContain('TrendingToForkSection');
    expect(dashboardSource).not.toContain('ReferralSharePrompt');
    expect(dashboardSource).not.toContain('followers: true');
    expect(dashboardSource).not.toContain('forkCount: true');
    expect(dashboardSource).not.toContain('likeCount: true');
  });

  it('does not keep private visibility behind a plan gate', () => {
    expect(readSource('src/components/ui/VisibilityToggle.tsx')).not.toContain('canMakePrivate');
    expect(readSource('src/app/podcast/[podcastId]/PodcastPlayerView.tsx')).not.toContain(
      'canMakePrivate'
    );
    expect(readSource('src/app/(dashboard)/dashboard/MyPodcastsSection.tsx')).not.toContain(
      'getTierFeatures'
    );
  });

  it('does not ship the public feed page or feed API route', () => {
    expect(existsSync(resolve(webRoot, 'src/app/feed/page.tsx'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/app/api/feed/route.ts'))).toBe(false);
  });

  it('does not keep public feed contracts in mobile, shared, or MCP packages', () => {
    const mobileSources = ['apps/mobile/app/(tabs)/index.tsx', 'apps/mobile/app/(tabs)/search.tsx']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const mcpSources = ['packages/mcp/src/server.ts', 'packages/mcp/src/client.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(mobileSources).not.toContain("'/feed'");
    expect(mobileSources).not.toContain('"/feed"');
    expect(mobileSources).not.toContain('/users/discover');
    expect(mobileSources).not.toContain('/users/suggested');
    expect(mcpSources).not.toContain('browse_feed');
    expect(mcpSources).not.toContain('/api/feed');
    expect(existsSync(resolve(repoRoot, 'packages/shared/src/types/feed.ts'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/types/feed.ts'))).toBe(false);
  });

  it('does not ship podcast social action routes or player widgets', () => {
    const removedRoutes = [
      'src/app/api/podcasts/[podcastId]/fork/route.ts',
      'src/app/api/podcasts/[podcastId]/fork-voice/route.ts',
      'src/app/api/podcasts/[podcastId]/like/route.ts',
      'src/app/api/podcasts/[podcastId]/comments/route.ts',
      'src/app/api/podcasts/[podcastId]/comments/[commentId]/route.ts',
      'src/app/api/podcasts/[podcastId]/comments/[commentId]/replies/route.ts',
      'src/app/api/podcasts/[podcastId]/lineage/route.ts',
      'src/app/api/podcasts/[podcastId]/voice-tracks/[trackId]/propose/route.ts',
      'src/app/api/users/[userId]/liked/route.ts',
    ];
    const removedComponents = [
      'src/components/player/ForkRemixModal.tsx',
      'src/components/player/VoiceRenditionForkModal.tsx',
      'src/components/player/ForkLineage.tsx',
      'src/components/player/ForkGraph.tsx',
      'src/components/player/ForkAttribution.tsx',
      'src/components/player/CommunityQuestions.tsx',
      'src/components/player/CommentSection.tsx',
      'src/components/player/CommentCard.tsx',
      'src/components/player/CommentCompose.tsx',
      'src/components/player/ShareMenu.tsx',
      'src/components/player/ProposeRenditionButton.tsx',
    ];
    const playerSource = readSource('src/app/podcast/[podcastId]/PodcastPlayerView.tsx');

    for (const route of removedRoutes) {
      expect(existsSync(resolve(webRoot, route)), route).toBe(false);
    }
    for (const component of removedComponents) {
      expect(existsSync(resolve(webRoot, component)), component).toBe(false);
    }
    expect(playerSource).not.toContain('/like');
    expect(playerSource).not.toContain('/fork');
    expect(playerSource).not.toContain('/comments');
    expect(playerSource).not.toContain('ShareMenu');
  });

  it('does not ship mobile podcast social actions or widgets', () => {
    const removedMobileComponents = [
      'apps/mobile/components/ForkModal.tsx',
      'apps/mobile/components/ForkLineage.tsx',
      'apps/mobile/components/CommentSection.tsx',
      'apps/mobile/components/CommentItem.tsx',
    ];
    const mobilePlayerSource = readFileSync(
      resolve(repoRoot, 'apps/mobile/app/podcast/[id].tsx'),
      'utf8'
    );
    const mobileCardSource = readFileSync(
      resolve(repoRoot, 'apps/mobile/components/PodcastCard.tsx'),
      'utf8'
    );
    const mobileProfileSource = readFileSync(
      resolve(repoRoot, 'apps/mobile/app/(tabs)/profile.tsx'),
      'utf8'
    );
    const mobilePodcastSurfaces = [mobilePlayerSource, mobileCardSource, mobileProfileSource].join(
      '\n'
    );

    for (const component of removedMobileComponents) {
      expect(existsSync(resolve(repoRoot, component)), component).toBe(false);
    }
    expect(mobilePlayerSource).not.toContain('/like');
    expect(mobilePlayerSource).not.toContain('/fork');
    expect(mobilePlayerSource).not.toContain('/comments');
    expect(mobilePlayerSource).not.toContain('Share.share');
    expect(mobilePlayerSource).not.toContain('ForkModal');
    expect(mobilePlayerSource).not.toContain('ForkLineage');
    expect(mobilePlayerSource).not.toContain('CommentSection');
    expect(mobilePodcastSurfaces).not.toContain('likeCount');
    expect(mobilePodcastSurfaces).not.toContain('forkCount');
  });

  it('does not ship mobile follow surfaces or social notification settings', () => {
    const removedMobileRoutes = [
      'apps/mobile/app/user/[userId].tsx',
      'apps/mobile/app/settings/notifications.tsx',
    ];
    const mobilePrivateSources = [
      'apps/mobile/app/_layout.tsx',
      'apps/mobile/app/settings.tsx',
      'apps/mobile/app/collections/index.tsx',
      'apps/mobile/app/collections/[id].tsx',
      'apps/mobile/app/analytics.tsx',
      'apps/mobile/app/(tabs)/notifications.tsx',
      'apps/mobile/CLAUDE.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    for (const route of removedMobileRoutes) {
      expect(existsSync(resolve(repoRoot, route)), route).toBe(false);
    }
    expect(mobilePrivateSources).not.toContain('/follow');
    expect(mobilePrivateSources).not.toContain('followerCount');
    expect(mobilePrivateSources).not.toContain('followingCount');
    expect(mobilePrivateSources).not.toContain('followMutation');
    expect(mobilePrivateSources).not.toContain('settings/notifications');
    expect(mobilePrivateSources).not.toContain('NEW_FOLLOWER');
    expect(mobilePrivateSources).not.toContain('NEW_LIKE');
    expect(mobilePrivateSources).not.toContain('NEW_FORK');
    expect(mobilePrivateSources).not.toContain('NEW_COMMENT');
  });
});
