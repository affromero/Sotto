import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = existsSync(resolve(process.cwd(), 'src'))
  ? process.cwd()
  : resolve(process.cwd(), 'apps/web');
const repoRoot = resolve(webRoot, '../..');

function readSource(relativePath: string): string {
  return readFileSync(resolve(webRoot, relativePath), 'utf8');
}

void readdirSync;

describe('open-source language-learning OSS surfaces', () => {
  const primarySurfaceFiles = [
    'src/components/layout/Sidebar.tsx',
    'src/components/layout/MobileNav.tsx',
    'src/components/layout/PublicNav.tsx',
    'src/components/layout/Footer.tsx',
    'src/components/landing/LandingHeader.tsx',
    'src/components/landing/LandingCTA.tsx',
    'src/components/landing/JsonLd.tsx',
    'src/app/page.tsx',
    'src/app/(dashboard)/dashboard/page.tsx',
    'src/app/episode/[episodeId]/EpisodePlayerView.tsx',
  ];
  void primarySurfaceFiles;

  it('requires explicit provider selection for BYOK key deletion', () => {
    const byokSources = [
      'src/app/api/v1/settings/byok/route.ts',
      'src/lib/validations.ts',
      'src/lib/CLAUDE.md',
    ]
      .map(readSource)
      .join('\n');

    expect(byokSources).toContain('byokProviderSchema');
    expect(byokSources).toContain("errorResponse('Provider is required', 400)");
    expect(byokSources).not.toContain('legacy behavior removes elevenlabs');
    expect(byokSources).not.toContain('validProviders');
    expect(byokSources).not.toContain('targetProvider');
    expect(byokSources).not.toContain("?'elevenlabs'");
    expect(byokSources).not.toContain("|| 'elevenlabs'");
  });

  it('rejects invalid voice provider selection instead of switching providers', () => {
    const voiceProviderSources = ['src/app/api/v1/voices/route.ts', 'tests/api/voices.test.ts']
      .map(readSource)
      .join('\n');

    expect(voiceProviderSources).toContain("errorResponse('Invalid provider', 400)");
    expect(voiceProviderSources).toContain('rejects invalid provider param');
    expect(voiceProviderSources).not.toContain(
      'falls back to elevenlabs for invalid provider param'
    );
  });

  it('keeps MCP contracts private-activity scoped', () => {
    const mcpSources = ['packages/mcp/src/types.ts', 'packages/mcp/src/format.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(mcpSources).not.toContain('EngagementSection');
    expect(mcpSources).not.toContain('collectionFollow');
    expect(mcpSources).not.toContain('followerCount');
    expect(mcpSources).not.toContain('followingCount');
    expect(mcpSources).not.toContain('likeCount');
    expect(mcpSources).not.toContain('forkCount');
    expect(mcpSources).not.toContain('forkedFromId');
    expect(mcpSources).not.toContain('isLiked');
    expect(mcpSources).not.toContain('Forked from');
  });

  it('keeps Prisma schema and seeds free of social tables', () => {
    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    const seedSources = ['apps/web/prisma/seed.ts', 'apps/web/prisma/seed-demo.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const prismaGuideSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/CLAUDE.md'), 'utf8');
    const databaseSources = [schemaSource, seedSources, prismaGuideSource].join('\n');

    expect(databaseSources).not.toContain('model Follow');
    expect(databaseSources).not.toContain('model Comment');
    expect(databaseSources).not.toContain('model Like');
    expect(databaseSources).not.toContain('model CollectionFollow');
    expect(databaseSources).not.toContain('model Activity');
    expect(databaseSources).not.toContain('model InteractionVote');
    expect(databaseSources).not.toContain('prisma.follow');
    expect(databaseSources).not.toContain('prisma.comment');
    expect(databaseSources).not.toContain('prisma.like');
    expect(databaseSources).not.toContain('likeCount');
    expect(databaseSources).not.toContain('forkCount');
    expect(databaseSources).not.toContain('commentCount');
    expect(databaseSources).not.toContain('followerCount');
    expect(databaseSources).not.toContain('forkedFromId');
    expect(databaseSources).not.toContain('remixNote');
    expect(databaseSources).not.toContain('upvoteCount');
    expect(databaseSources).not.toContain('likeToListenRatio');
    expect(databaseSources).not.toContain('prod-remix');
  });

  it('keeps episode summary contracts free of social payload fields', () => {
    const summaryContractSources = [
      'src/types/episode.ts',
      'src/types/CLAUDE.md',
      'src/lib/episode-select.ts',
      'src/lib/episode-data.ts',
      'src/app/api/v1/saved/route.ts',
      'src/app/episode/[episodeId]/page.tsx',
    ]
      .map(readSource)
      .concat(readFileSync(resolve(repoRoot, 'packages/shared/src/types/episode.ts'), 'utf8'))
      .join('\n');
    const episodeRouteSource = readSource('src/app/api/v1/episodes/[episodeId]/route.ts');
    const adminEpisodeRouteSource = readSource(
      'src/app/api/v1/admin/episodes/[episodeId]/route.ts'
    );

    expect(summaryContractSources).not.toContain('saveCount');
    expect(summaryContractSources).not.toContain('likeCount');
    expect(summaryContractSources).not.toContain('forkCount');
    expect(summaryContractSources).not.toContain('forkedFromId');
    expect(summaryContractSources).not.toContain('forkedFrom');
    expect(summaryContractSources).not.toContain('forks');
    expect(summaryContractSources).not.toContain('remixNote');
    expect(summaryContractSources).not.toContain('isLiked');
    expect(summaryContractSources).not.toContain('commentCount');
    expect(episodeRouteSource).not.toContain('isLiked');
    expect(episodeRouteSource).not.toContain('prisma.like');
    expect(episodeRouteSource).not.toContain('forkedFromId');
    expect(episodeRouteSource).not.toContain('forkCount');
    expect(adminEpisodeRouteSource).not.toContain('forkedFromId');
    expect(adminEpisodeRouteSource).not.toContain('forkCount');
  });

  it('does not ship the curated-playlist collections feature', () => {
    const removedCollectionPaths = [
      'apps/web/src/app/api/v1/collections',
      'apps/web/src/app/collections',
      'apps/web/src/components/collections',
      'e2e/playwright/tests/api/collections.api.spec.ts',
    ];
    for (const path of removedCollectionPaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    expect(schemaSource).not.toContain('model Collection');
    expect(schemaSource).not.toContain('model CollectionItem');
  });

  it('does not ship user follow or discovery social contracts', () => {
    const removedUserSocialRoutes = [
      'src/app/api/v1/users/[userId]/follow/route.ts',
      'src/app/api/v1/users/[userId]/followers/route.ts',
      'src/app/api/v1/users/[userId]/following/route.ts',
      'src/app/api/v1/users/[userId]/activity/route.ts',
      'src/app/api/v1/users/discover/route.ts',
      'src/app/api/v1/users/suggested/route.ts',
    ];
    const removedDiscoverySocialComponents = [
      'src/components/discovery/CreatorSuggestion.tsx',
      'src/components/discovery/CreatorSuggestion.module.css',
      'src/components/discovery/RecommendationCard.tsx',
      'src/components/discovery/RecommendationCard.module.css',
    ];
    const userApiSources = [
      'src/app/api/v1/users/me/route.ts',
      'src/app/api/v1/users/me/export/route.ts',
      'src/lib/notification-utils.ts',
      'src/components/notifications/NotificationList.tsx',
      'src/components/CLAUDE.md',
    ]
      .map(readSource)
      .join('\n');
    const userValidationSources = ['src/lib/validations.ts'].map(readSource).join('\n');
    const activityWriteSources = ['src/app/api/v1/episodes/route.ts'].map(readSource).join('\n');

    for (const route of removedUserSocialRoutes) {
      expect(existsSync(resolve(webRoot, route)), route).toBe(false);
    }
    for (const component of removedDiscoverySocialComponents) {
      expect(existsSync(resolve(webRoot, component)), component).toBe(false);
    }
    expect(userApiSources).not.toContain('prisma.follow');
    expect(userApiSources).not.toContain('prisma.like');
    expect(userApiSources).not.toContain('prisma.comment');
    expect(userApiSources).not.toContain('forkedFromId');
    expect(userApiSources).not.toContain('followerCount');
    expect(userApiSources).not.toContain('followingCount');
    expect(userApiSources).not.toContain('isFollowing');
    expect(userApiSources).not.toContain('socialGraph');
    expect(userApiSources).not.toContain('prisma.activity');
    expect(activityWriteSources).not.toContain('prisma.activity');
    expect(activityWriteSources).not.toContain('EPISODE_CREATED');
    expect(activityWriteSources).not.toContain('COLLECTION_CREATED');
    expect(userApiSources).not.toContain('NEW_FOLLOWER');
    expect(userApiSources).not.toContain('CreatorSuggestion');
    expect(userApiSources).not.toContain('RecommendationCard');
    expect(userValidationSources).not.toContain('voiceForkBodySchema');
    expect(userValidationSources).not.toContain('forkBodySchema');
    expect(userValidationSources).not.toContain('remixNote');
    expect(userValidationSources).not.toContain('createCommentSchema');
    expect(userValidationSources).not.toContain("'following'");
  });

  it('does not ship directory-style user search or @handles', () => {
    expect(existsSync(resolve(webRoot, 'src/app/api/v1/users/search'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/app/api/v1/handles'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/lib/handles.ts'))).toBe(false);
    const validationSource = readSource('src/lib/validations.ts');

    expect(validationSource).not.toContain('handleSchema');
    expect(validationSource).not.toContain('userSearchSchema');
  });

  it('does not ship the voice marketplace', () => {
    const removedMarketplacePaths = [
      'apps/web/src/lib/voice-pricing.ts',
      'apps/web/src/lib/revenue-metrics.ts',
      'apps/web/src/app/api/v1/voices/request',
      'apps/web/src/app/api/v1/voices/allowlist',
      'apps/web/src/app/api/v1/stripe/connect',
      'apps/web/src/app/api/v1/stripe/payment-intent',
      'apps/web/src/app/(admin)/admin/revenue',
    ];
    for (const path of removedMarketplacePaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    expect(schemaSource).not.toContain('model VoiceRequest');
    expect(schemaSource).not.toContain('model VoicePurchase');
    expect(schemaSource).not.toContain('model VoiceAllowlist');

    // The shared voice directory still redirects to /learn.
    expect(readSource('src/app/voices/page.tsx')).toContain("redirect('/learn')");
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
      'src/components/profile/EpisodeList.tsx',
      'src/components/profile/EpisodeList.module.css',
      'src/app/api/v1/users/[userId]/route.ts',
      'src/app/api/v1/users/[userId]/collections/route.ts',
      'src/app/api/v1/users/[userId]/rss/route.ts',
      'src/app/api/v1/users/handle/[handle]/rss/route.ts',
    ];
    const removedPublicProfileTests = ['apps/web/tests/api/users-profile.test.ts'];
    const publicProfileSources = [
      'src/app/profile/page.tsx',
      'src/lib/urls.ts',
      'src/lib/CLAUDE.md',
      'src/app/sitemap.ts',
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
    for (const file of removedPublicProfileTests) {
      expect(existsSync(resolve(repoRoot, file)), file).toBe(false);
    }
    expect(profileShortcutSource).toContain("redirect('/settings')");
    expect(publicProfileSources).not.toContain('/api/v1/users/[id]');
    expect(publicProfileSources).not.toContain('/api/v1/users/[id]/collections');
    expect(publicProfileSources).not.toContain('/api/v1/users/[id]/activity');
    expect(publicProfileSources).not.toContain('profileUrl');
    expect(publicProfileSources).not.toContain('absoluteProfileUrl');
    expect(publicProfileSources).not.toContain('generateCreatorRssFeed');
    expect(publicProfileSources).not.toContain('/api/v1/users/${user.id}/rss');
    expect(publicProfileSources).not.toContain('ProfileClient');
    expect(publicProfileSources).not.toContain('ProfileHeader');
    expect(publicProfileSources).not.toContain('FollowerCount');
    expect(publicProfileSources).not.toContain('FollowListModal');
    expect(publicProfileSources).not.toContain('UserCard');
    expect(nextConfigSource).not.toContain("source: '/@:handle'");
    expect(nextConfigSource).not.toContain('/profile/handle/:handle');
  });
});
