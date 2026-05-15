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
    const sharedPositioningSource = [
      'packages/shared/src/brand.ts',
      'apps/web/src/lib/marketing-templates.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(landingSource).not.toContain('social podcast network');
    expect(landingSource).not.toContain('social feed');
    expect(landingSource).not.toContain('social features');
    expect(landingSource).not.toContain('Fork and remix any public podcast');
    expect(sharedPositioningSource).not.toContain('social podcast network');
    expect(sharedPositioningSource).not.toContain('social feed');
    expect(sharedPositioningSource).not.toContain('GitHub for podcasts');
    expect(sharedPositioningSource).not.toContain('Create. Fork. Remix. Share.');
    expect(sharedPositioningSource).not.toContain('fork and remix anything');
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
    const creatorMetricsSource = readSource('src/lib/creator-metrics.ts');

    expect(existsSync(resolve(webRoot, 'src/app/feed/page.tsx'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/app/api/feed/route.ts'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/app/api/activity/route.ts'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/components/feed/ActivityFeed.tsx'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/components/feed/ActivityItem.tsx'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'e2e/playwright/tests/feed.spec.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'e2e/playwright/tests/api/feed-social.api.spec.ts'))).toBe(
      false
    );
    expect(existsSync(resolve(repoRoot, 'scripts/recording/flows/01-feed-browsing.ts'))).toBe(
      false
    );
    expect(creatorMetricsSource).not.toContain("LIKE '%/feed%'");
    expect(creatorMetricsSource).not.toContain("THEN 'feed'");
  });

  it('does not keep public feed contracts in mobile, shared, or MCP packages', () => {
    const mobileSources = ['apps/mobile/app/(tabs)/index.tsx', 'apps/mobile/app/(tabs)/search.tsx']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const mcpSources = ['packages/mcp/src/server.ts', 'packages/mcp/src/client.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const eventSources = [
      'src/types/events.ts',
      'src/lib/validations/events.ts',
      'src/components/feed/PodcastCard.tsx',
      'src/components/feed/SearchBar.tsx',
      'src/lib/hooks/useImpressionTracker.ts',
    ]
      .map(readSource)
      .concat(readFileSync(resolve(repoRoot, 'packages/shared/src/types/events.ts'), 'utf8'))
      .join('\n');

    expect(mobileSources).not.toContain("'/feed'");
    expect(mobileSources).not.toContain('"/feed"');
    expect(mobileSources).not.toContain('/users/discover');
    expect(mobileSources).not.toContain('/users/suggested');
    expect(mcpSources).not.toContain('browse_feed');
    expect(mcpSources).not.toContain('/api/feed');
    expect(eventSources).not.toContain('feed.impression');
    expect(eventSources).not.toContain('feed.click');
    expect(eventSources).not.toContain('feed.search');
    expect(eventSources).not.toContain('feedSort');
    expect(eventSources).not.toContain('social.like');
    expect(eventSources).not.toContain('social.follow');
    expect(eventSources).not.toContain('social.fork');
    expect(eventSources).toContain('library.impression');
    expect(eventSources).toContain('library.click');
    expect(eventSources).toContain('library.search');
    expect(existsSync(resolve(repoRoot, 'packages/shared/src/types/feed.ts'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/types/feed.ts'))).toBe(false);
  });

  it('does not ship the standalone social feed ranking workspace', () => {
    const workspaceSources = [
      'package.json',
      'package-lock.json',
      'apps/web/package.json',
      'apps/web/next.config.js',
      'apps/web/Dockerfile',
      'apps/web/Dockerfile.workers',
      'apps/web/src/lib/recommendation-engine.ts',
      'apps/web/src/lib/providers/ml.ts',
      'apps/web/src/workers/feature-computation.worker.ts',
      'apps/web/src/lib/CLAUDE.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(existsSync(resolve(repoRoot, 'packages/feed'))).toBe(false);
    expect(workspaceSources).not.toContain('@sottofm/feed');
    expect(workspaceSources).not.toContain('packages/feed');
    expect(workspaceSources).not.toContain('From Your People');
    expect(workspaceSources).not.toContain('followedCreatorIds');
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

  it('does not ship collection follow contracts', () => {
    const collectionSources = [
      'src/app/collections/[collectionId]/page.tsx',
      'src/app/api/collections/route.ts',
      'src/app/api/collections/[collectionId]/route.ts',
      'src/app/api/users/[userId]/collections/route.ts',
      'src/components/collections/CollectionDetail.tsx',
      'src/components/collections/CollectionCard.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(
      existsSync(resolve(webRoot, 'src/app/api/collections/[collectionId]/follow/route.ts'))
    ).toBe(false);
    expect(collectionSources).not.toContain('/follow');
    expect(collectionSources).not.toContain('collectionFollow');
    expect(collectionSources).not.toContain('followerCount');
    expect(collectionSources).not.toContain('isFollowing');
  });

  it('does not ship user follow or discovery API contracts', () => {
    const removedUserSocialRoutes = [
      'src/app/api/users/[userId]/follow/route.ts',
      'src/app/api/users/[userId]/followers/route.ts',
      'src/app/api/users/[userId]/following/route.ts',
      'src/app/api/users/discover/route.ts',
      'src/app/api/users/suggested/route.ts',
    ];
    const userApiSources = [
      'src/app/api/users/[userId]/route.ts',
      'src/app/api/users/me/route.ts',
      'src/app/api/users/me/export/route.ts',
      'src/lib/notification-utils.ts',
      'src/components/notifications/NotificationList.tsx',
    ]
      .map(readSource)
      .join('\n');

    for (const route of removedUserSocialRoutes) {
      expect(existsSync(resolve(webRoot, route)), route).toBe(false);
    }
    expect(userApiSources).not.toContain('prisma.follow');
    expect(userApiSources).not.toContain('followerCount');
    expect(userApiSources).not.toContain('followingCount');
    expect(userApiSources).not.toContain('isFollowing');
    expect(userApiSources).not.toContain('socialGraph');
    expect(userApiSources).not.toContain('NEW_FOLLOWER');
  });

  it('does not ship public profile pages or creator RSS routes', () => {
    const removedPublicProfileFiles = [
      'src/app/profile/[userId]/ProfileClient.tsx',
      'src/app/profile/[userId]/page.tsx',
      'src/app/profile/[userId]/page.module.css',
      'src/app/profile/[userId]/opengraph-image.tsx',
      'src/app/profile/handle/[handle]/page.tsx',
      'src/app/profile/handle/[handle]/page.module.css',
      'src/app/profile/handle/[handle]/opengraph-image.tsx',
      'src/components/profile/FollowButton.tsx',
      'src/components/profile/FollowButton.module.css',
      'src/components/profile/FollowerCount.tsx',
      'src/components/profile/FollowerCount.module.css',
      'src/components/profile/FollowListModal.tsx',
      'src/components/profile/FollowListModal.module.css',
      'src/components/profile/UserCard.tsx',
      'src/components/profile/UserCard.module.css',
      'src/components/profile/ProfileHeader.tsx',
      'src/components/profile/ProfileHeader.module.css',
      'src/components/profile/PodcastList.tsx',
      'src/components/profile/PodcastList.module.css',
      'src/app/api/users/[userId]/rss/route.ts',
      'src/app/api/users/handle/[handle]/rss/route.ts',
    ];
    const publicProfileSources = [
      'src/app/profile/page.tsx',
      'src/lib/urls.ts',
      'src/lib/rss.ts',
      'src/lib/CLAUDE.md',
      'src/app/api/oembed/route.ts',
      'src/app/sitemap.ts',
      'src/components/player/Contributors.tsx',
      'src/components/voices/VoiceMarketplaceCard.tsx',
      'src/app/CLAUDE.md',
      'src/components/CLAUDE.md',
    ]
      .map(readSource)
      .join('\n');
    const nextConfigSource = readFileSync(resolve(webRoot, 'next.config.js'), 'utf8');
    const profileShortcutSource = readSource('src/app/profile/page.tsx');

    for (const file of removedPublicProfileFiles) {
      expect(existsSync(resolve(webRoot, file)), file).toBe(false);
    }
    expect(profileShortcutSource).toContain("redirect('/settings')");
    expect(publicProfileSources).not.toContain('profileUrl');
    expect(publicProfileSources).not.toContain('absoluteProfileUrl');
    expect(publicProfileSources).not.toContain('generateCreatorRssFeed');
    expect(publicProfileSources).not.toContain('/api/users/${user.id}/rss');
    expect(publicProfileSources).not.toContain('ProfileClient');
    expect(publicProfileSources).not.toContain('ProfileHeader');
    expect(publicProfileSources).not.toContain('FollowerCount');
    expect(publicProfileSources).not.toContain('FollowListModal');
    expect(publicProfileSources).not.toContain('UserCard');
    expect(nextConfigSource).not.toContain("source: '/@:handle'");
    expect(nextConfigSource).not.toContain('/profile/handle/:handle');
  });
});
