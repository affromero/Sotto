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

  it('keeps public product copy private-first', () => {
    const webCopySources = [
      'src/app/about/page.tsx',
      'src/app/join/page.tsx',
      'src/app/pricing/page.tsx',
      'src/app/developers/page.tsx',
      'src/app/terms/page.tsx',
      'src/app/privacy/page.tsx',
      'src/app/support/page.tsx',
      'src/app/layout.tsx',
      'src/app/(admin)/admin/showcase/ActionEditor.tsx',
      'src/app/(dashboard)/settings/SettingsForm.tsx',
      'src/components/referral/JoinCTA.tsx',
      'src/components/voices/VoicePaymentModal.tsx',
    ]
      .map(readSource)
      .join('\n');
    const mobileCopySources = ['apps/mobile/app/settings/referral.tsx']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const copySources = [webCopySources, mobileCopySources].join('\n');

    expect(copySources).toContain('private');
    expect(copySources).not.toContain('social podcast network');
    expect(copySources).not.toContain('social feed');
    expect(copySources).not.toContain('social features');
    expect(copySources).not.toContain('social graph');
    expect(copySources).not.toContain('open podcast network');
    expect(copySources).not.toContain('Fork and remix');
    expect(copySources).not.toContain('fork and remix');
    expect(copySources).not.toContain('Forking');
    expect(copySources).not.toContain('forked version');
    expect(copySources).not.toContain('likes, and follows');
    expect(copySources).not.toContain('followerCount');
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

  it('requires MCP clients to target an explicit Sotto deployment URL', () => {
    const mcpIndexSource = readFileSync(resolve(repoRoot, 'packages/mcp/src/index.ts'), 'utf8');
    const mcpClientSource = readFileSync(resolve(repoRoot, 'packages/mcp/src/client.ts'), 'utf8');
    const mcpReadme = readFileSync(resolve(repoRoot, 'packages/mcp/README.md'), 'utf8');
    const mcpRuntimeSources = [mcpIndexSource, mcpClientSource].join('\n');

    expect(mcpIndexSource).toContain('SOTTO_API_URL environment variable is required');
    expect(mcpClientSource).toContain('constructor(apiKey: string, baseUrl: string)');
    expect(mcpRuntimeSources).not.toContain('https://sotto.fm');
    expect(mcpRuntimeSources).not.toMatch(/SOTTO_API_URL\s*\|\|/);
    expect(mcpClientSource).not.toMatch(/baseUrl:\s*string\s*=/);
    expect(mcpReadme).toContain('| `SOTTO_API_URL` | Yes');
    expect(mcpReadme).not.toContain('| `SOTTO_API_URL` | No');
    expect(mcpReadme).not.toContain('`https://sotto.fm`');
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
      'src/app/api/podcasts/[podcastId]/interact/[interactionId]/vote/route.ts',
      'src/app/api/podcasts/[podcastId]/lineage/route.ts',
      'src/app/api/podcasts/[podcastId]/questions/route.ts',
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
    const podcastCardSource = [
      'src/components/feed/PodcastCard.tsx',
      'src/components/feed/PodcastCard.module.css',
      'src/components/landing/chapters/AudioClipPlayer.tsx',
    ]
      .map(readSource)
      .join('\n');

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
    expect(podcastCardSource).not.toContain('router.push');
    expect(podcastCardSource).not.toContain('?fork=1');
    expect(podcastCardSource).not.toContain('forkButton');
    expect(podcastCardSource).not.toContain('Remix of');
    expect(podcastCardSource).not.toContain('likeCount');
    expect(podcastCardSource).not.toContain('forkCount');
  });

  it('does not keep social notification types or public Q&A voting tests', () => {
    const notificationSources = [
      'src/lib/notification-utils.ts',
      'src/components/notifications/NotificationList.tsx',
    ]
      .map(readSource)
      .concat([
        readFileSync(resolve(repoRoot, 'packages/shared/src/types/enums.ts'), 'utf8'),
        readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8'),
        readFileSync(resolve(repoRoot, 'apps/web/prisma/CLAUDE.md'), 'utf8'),
        readFileSync(resolve(repoRoot, 'e2e/playwright/helpers/seed.ts'), 'utf8'),
      ])
      .join('\n');
    const removedTests = [
      'apps/web/tests/api/podcasts-questions.test.ts',
      'e2e/playwright/tests/api/podcast-social.api.spec.ts',
      'e2e/playwright/tests/api/feed-social.api.spec.ts',
      'e2e/playwright/tests/api/users-public.api.spec.ts',
      'e2e/playwright/tests/fork.spec.ts',
      'scripts/recording/flows/04-fork-flow.ts',
    ];

    for (const testPath of removedTests) {
      expect(existsSync(resolve(repoRoot, testPath)), testPath).toBe(false);
    }
    expect(notificationSources).not.toContain('PODCAST_LIKED');
    expect(notificationSources).not.toContain('PODCAST_FORKED');
    expect(notificationSources).not.toContain('NEW_FOLLOWER');
    expect(notificationSources).not.toContain('SIMILAR_PODCAST_CREATED');
    expect(notificationSources).not.toContain('QUESTION_UPVOTED');
    expect(notificationSources).not.toContain('COMMENT_ON_YOUR_PODCAST');
    expect(notificationSources).not.toContain('COMMENT_REPLY');
  });

  it('keeps demo and automation harnesses private-first', () => {
    const harnessSources = [
      'e2e/llmock/setup.ts',
      'e2e/playwright/tests/podcast-player.spec.ts',
      'scripts/launch-video/SYSTEM_PROMPT.md',
      'scripts/launch-video/AUTHORING_GUIDE.md',
      'scripts/recording/index.ts',
      'scripts/ml/prepare-quality-training.ts',
      'apps/web/src/app/changelog/page.tsx',
      'apps/web/src/app/onboarding/KeySetupForm.tsx',
      'apps/web/src/lib/CLAUDE.md',
      'apps/web/src/lib/auth-guards.ts',
      'apps/web/src/lib/demo-context.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(harnessSources).not.toMatch(/\bfork\b/i);
    expect(harnessSources).not.toMatch(/\bremix\b/i);
    expect(harnessSources).not.toContain('social feed');
    expect(harnessSources).not.toContain('explore the feed');
    expect(harnessSources).not.toContain('likeToListenRatio');
    expect(harnessSources).not.toContain('forkToListenRatio');
  });

  it('keeps release docs aligned with private-first OSS strategy', () => {
    const removedPitchDocs = [
      'docs/02-ui-mockups.md',
      'docs/03-market-analysis.md',
      'docs/04-post-pivot-analysis.md',
      'docs/06-discovery-chat-flow.md',
      'docs/08-design-system.md',
      'docs/09-unit-economics.md',
      'docs/12-shipping-roadmap.md',
      'docs/13-mvp-launch-guide.md',
      'docs/14-mobile-strategy.md',
      'docs/15-ios-app-strategy.md',
      'docs/22-palette-brief.md',
      'docs/data-moat-narrative.md',
      'docs/data-moat-narrative.html',
    ];
    const docsDir = resolve(repoRoot, 'docs');
    const releaseDocPaths = [
      'README.md',
      'CLAUDE.md',
      'scripts/rebuild-pitch.sh',
      ...readdirSync(docsDir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => `docs/${name}`),
    ];
    const releaseDocsSource = releaseDocPaths
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const staleClaims = [
      'Every voice. Every topic. One feed',
      'Where podcasts get social',
      'social podcast network',
      'GitHub for podcasts',
      'public on a social feed',
      'Public podcasts on a social feed',
      'Social Discovery Feed',
      'Fork & remix',
      'fork & remix',
      'fork and remix anyone',
      'Trending to Fork',
      'YouTube of AI podcasts',
      'PODCAST_FORKED',
      'NEW_FOLLOWER',
      'Explore Feed',
      'Public Feed',
      '/api/feed',
      '/profile/[userId]',
      'All secrets via **Doppler**',
      'Syncs prod DB + starts web + workers',
    ];

    for (const doc of removedPitchDocs) {
      expect(existsSync(resolve(repoRoot, doc)), doc).toBe(false);
    }
    for (const claim of staleClaims) {
      expect(releaseDocsSource, claim).not.toContain(claim);
    }
    expect(releaseDocsSource).toContain('Private audio briefings');
    expect(releaseDocsSource).toContain('private RSS');
    expect(releaseDocsSource).toContain('implicit provider fallback');
    expect(releaseDocsSource).toContain('Managed hosting');
  });

  it('keeps Twitter auto-tweet thresholds scoped to private playback', () => {
    const twitterThresholdSources = [
      'src/lib/twitter-auto-tweet.ts',
      'src/lib/twitter-config.ts',
      'src/types/twitter.ts',
      'src/lib/validations.ts',
      'src/app/(admin)/admin/twitter/AutoTweetSection.tsx',
    ]
      .map(readSource)
      .concat(readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8'))
      .join('\n');

    expect(twitterThresholdSources).toContain('minPlays');
    expect(twitterThresholdSources).not.toContain('minLikes');
    expect(twitterThresholdSources).not.toContain('minForks');
    expect(twitterThresholdSources).not.toContain('likeCount >=');
    expect(twitterThresholdSources).not.toContain('forkCount >=');
    expect(twitterThresholdSources).not.toContain('Min Likes');
    expect(twitterThresholdSources).not.toContain('Min Forks');
  });

  it('keeps admin activity metrics private instead of social', () => {
    const activityMetricSources = [
      'src/lib/engagement-metrics.ts',
      'src/app/(admin)/admin/engagement/page.tsx',
      'src/app/(admin)/AdminShell.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(activityMetricSources).toContain('Private Activity');
    expect(activityMetricSources).toContain('getTopSaved');
    expect(activityMetricSources).not.toContain('getTopLiked');
    expect(activityMetricSources).not.toContain('getTopForked');
    expect(activityMetricSources).not.toContain('likeCount');
    expect(activityMetricSources).not.toContain('forkCount');
    expect(activityMetricSources).not.toContain('followerCount');
    expect(activityMetricSources).not.toContain('prisma.like');
    expect(activityMetricSources).not.toContain('prisma.follow');
  });

  it('keeps podcast analytics scoped to private listener activity', () => {
    const podcastAnalyticsSources = [
      'src/lib/podcast-analytics.ts',
      'src/app/podcast/[podcastId]/analytics/page.tsx',
      'src/app/api/podcasts/[podcastId]/analytics/route.ts',
    ]
      .map(readSource)
      .join('\n');

    expect(podcastAnalyticsSources).toContain('getPodcastPrivateActivity');
    expect(podcastAnalyticsSources).toContain('Private Activity');
    expect(podcastAnalyticsSources).not.toContain('getPodcastEngagement');
    expect(podcastAnalyticsSources).not.toContain('likeCount');
    expect(podcastAnalyticsSources).not.toContain('forkCount');
    expect(podcastAnalyticsSources).not.toContain('commentCount');
    expect(podcastAnalyticsSources).not.toContain('Upvotes');
    expect(podcastAnalyticsSources).not.toContain("label: 'Likes'");
    expect(podcastAnalyticsSources).not.toContain("label: 'Forks'");
    expect(podcastAnalyticsSources).not.toContain("label: 'Comments'");
  });

  it('keeps creator analytics scoped to private activity', () => {
    const creatorAnalyticsSources = [
      'src/lib/creator-metrics.ts',
      'src/app/(dashboard)/analytics/AnalyticsClient.tsx',
      'src/app/(dashboard)/analytics/page.tsx',
      'src/app/api/creator-analytics/route.ts',
      'src/types/analytics.ts',
    ]
      .map(readSource)
      .concat(readFileSync(resolve(repoRoot, 'packages/shared/src/types/analytics.ts'), 'utf8'))
      .join('\n');

    expect(creatorAnalyticsSources).toContain('privateActivity');
    expect(creatorAnalyticsSources).toContain('getCreatorPrivateActivity');
    expect(creatorAnalyticsSources).not.toContain('getCreatorEngagement');
    expect(creatorAnalyticsSources).not.toContain('CreatorEngagement');
    expect(creatorAnalyticsSources).not.toContain('data.engagement');
    expect(creatorAnalyticsSources).not.toContain('likeCount');
    expect(creatorAnalyticsSources).not.toContain('forkCount');
    expect(creatorAnalyticsSources).not.toContain('prisma.like');
    expect(creatorAnalyticsSources).not.toContain('prisma.follow');
    expect(creatorAnalyticsSources).not.toContain("label: 'Likes'");
    expect(creatorAnalyticsSources).not.toContain("label: 'Forks'");
    expect(creatorAnalyticsSources).not.toContain("label: 'Follows'");
  });

  it('keeps similar-podcast recommendations free of social ranking payloads', () => {
    const recommendationSources = [
      'src/lib/recommendations.ts',
      'src/app/api/recommendations/route.ts',
    ]
      .map(readSource)
      .join('\n');

    expect(recommendationSources).toContain("saveCount: 'desc'");
    expect(recommendationSources).not.toContain('likeCount');
    expect(recommendationSources).not.toContain('forkCount');
  });

  it('keeps daily picks and trending free of social ranking payloads', () => {
    const recommendationEngineSource = readSource('src/lib/recommendation-engine.ts');

    expect(recommendationEngineSource).toContain("saveCount: 'desc'");
    expect(recommendationEngineSource).toContain('Listen velocity');
    expect(recommendationEngineSource).not.toContain('likeCount');
    expect(recommendationEngineSource).not.toContain('forkCount');
    expect(recommendationEngineSource).not.toContain('forkedFromId');
    expect(recommendationEngineSource).not.toContain("likeCount: 'desc'");
  });

  it('keeps recommendation training exports free of social labels', () => {
    const trainingExportSources = [
      'src/workers/data-export.worker.ts',
      '../../scripts/ml/prepare-recommendation-training.ts',
    ]
      .map(readSource)
      .join('\n');

    expect(trainingExportSources).toContain('trainingLabel');
    expect(trainingExportSources).toContain('saved');
    expect(trainingExportSources).not.toContain('liked');
    expect(trainingExportSources).not.toContain('forked');
    expect(trainingExportSources).not.toContain('forkedFromId');
    expect(trainingExportSources).not.toContain('engagementLabel');
    expect(trainingExportSources).not.toContain('prisma.like');
  });

  it('keeps reports and content moderation free of comment targets', () => {
    const reportModerationSources = [
      'src/app/api/reports/route.ts',
      'src/lib/validations.ts',
      'src/components/ui/ReportModal.tsx',
      'src/components/ui/ReportButton.tsx',
      'src/app/(admin)/admin/moderation/ReportQueue.tsx',
      'src/lib/queue.ts',
      'src/workers/content-moderation.worker.ts',
    ]
      .map(readSource)
      .join('\n');

    expect(reportModerationSources).not.toContain('prisma.comment');
    expect(reportModerationSources).not.toContain("targetType === 'comment'");
    expect(reportModerationSources).not.toContain("'podcast' | 'comment'");
    expect(reportModerationSources).not.toContain("'podcast', 'comment', 'user'");
    expect(reportModerationSources).not.toContain('value="comment"');
    expect(reportModerationSources).not.toContain('Comment not found');
    expect(reportModerationSources).not.toContain('(podcast scripts, comments)');
  });

  it('keeps admin storage inspector private-activity scoped', () => {
    const storageInspectorSources = [
      'src/app/(admin)/admin/storage/[podcastId]/page.tsx',
      'src/app/(admin)/admin/storage/[podcastId]/InspectorContent.tsx',
      'src/app/(admin)/admin/storage/[podcastId]/page.module.css',
    ]
      .map(readSource)
      .join('\n');

    expect(storageInspectorSources).toContain('Private Activity');
    expect(storageInspectorSources).toContain('privateActivityGrid');
    expect(storageInspectorSources).not.toContain('likeCount');
    expect(storageInspectorSources).not.toContain('forkCount');
    expect(storageInspectorSources).not.toContain('commentCount');
    expect(storageInspectorSources).not.toContain('Likes');
    expect(storageInspectorSources).not.toContain('Forks');
    expect(storageInspectorSources).not.toContain('Comments');
  });

  it('keeps traffic report and MCP contracts private-activity scoped', () => {
    const trafficReportSource = readSource('src/lib/traffic-report.ts');
    const librarySource = readSource('src/app/(dashboard)/ideas/LibraryClient.tsx');
    const collectionE2ESource = readFileSync(
      resolve(repoRoot, 'e2e/playwright/tests/api/collections.api.spec.ts'),
      'utf8'
    );
    const mcpSources = ['packages/mcp/src/types.ts', 'packages/mcp/src/format.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const privateContractSources = [
      trafficReportSource,
      librarySource,
      collectionE2ESource,
      mcpSources,
    ].join('\n');

    expect(trafficReportSource).toContain('PrivateActivitySection');
    expect(trafficReportSource).toContain('privateActivity');
    expect(trafficReportSource).toContain('topSaved');
    expect(trafficReportSource).toContain('largestByItems');
    expect(privateContractSources).not.toContain('EngagementSection');
    expect(privateContractSources).not.toContain('collectionFollow');
    expect(privateContractSources).not.toContain('followerCount');
    expect(privateContractSources).not.toContain('followingCount');
    expect(privateContractSources).not.toContain('likeCount');
    expect(privateContractSources).not.toContain('forkCount');
    expect(privateContractSources).not.toContain('forkedFromId');
    expect(privateContractSources).not.toContain('isLiked');
    expect(privateContractSources).not.toContain('Forked from');
    expect(collectionE2ESource).not.toContain('/follow');
  });

  it('keeps feature computation private-signal scoped', () => {
    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    const userFeatureModel = schemaSource.slice(
      schemaSource.indexOf('model UserFeature'),
      schemaSource.indexOf('model PodcastFeature')
    );
    const podcastFeatureModel = schemaSource.slice(
      schemaSource.indexOf('model PodcastFeature'),
      schemaSource.indexOf('model BehavioralEvent')
    );
    const featureSources = [
      'src/workers/feature-computation.worker.ts',
      'src/workers/data-export.worker.ts',
      'src/app/api/podcasts/[podcastId]/quality/route.ts',
      'src/workers/CLAUDE.md',
    ]
      .map(readSource)
      .concat(userFeatureModel, podcastFeatureModel)
      .join('\n');

    expect(featureSources).toContain('Private activity');
    expect(featureSources).toContain('saveToListenRatio');
    expect(featureSources).toContain('interactionRate');
    expect(featureSources).not.toContain('prisma.like');
    expect(featureSources).not.toContain('prisma.follow');
    expect(featureSources).not.toContain('followingCount');
    expect(featureSources).not.toContain('followerCount');
    expect(featureSources).not.toContain('likeRate');
    expect(featureSources).not.toContain('forkRate');
    expect(featureSources).not.toContain('likeToListenRatio');
    expect(featureSources).not.toContain('forkToListenRatio');
    expect(featureSources).not.toContain('forkedFromId');
    expect(featureSources).not.toContain('liked: pct');
    expect(featureSources).not.toContain('forked: pct');
  });

  it('keeps Prisma schema and seeds free of social tables', () => {
    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    const seedSources = [
      'apps/web/prisma/seed.ts',
      'apps/web/prisma/seed-demo.ts',
      'e2e/playwright/helpers/seed.ts',
    ]
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

  it('keeps podcast summary contracts free of social payload fields', () => {
    const summaryContractSources = [
      'src/types/podcast.ts',
      'src/types/CLAUDE.md',
      'src/lib/podcast-select.ts',
      'src/lib/podcast-data.ts',
      'src/app/api/saved/route.ts',
      'src/app/api/queue/route.ts',
      'src/app/api/users/me/podcasts/route.ts',
      'src/app/api/collections/[collectionId]/route.ts',
      'src/app/collections/[collectionId]/page.tsx',
      'src/app/api/inspire/all/route.ts',
      'src/components/feed/DailyPicks.tsx',
      'src/app/podcast/[podcastId]/page.tsx',
      'src/app/(dashboard)/dashboard/MyPodcastsSection.tsx',
    ]
      .map(readSource)
      .concat(readFileSync(resolve(repoRoot, 'packages/shared/src/types/podcast.ts'), 'utf8'))
      .join('\n');
    const podcastRouteSource = readSource('src/app/api/podcasts/[podcastId]/route.ts');
    const adminPodcastRouteSource = readSource('src/app/api/admin/podcasts/[podcastId]/route.ts');

    expect(summaryContractSources).toContain('saveCount');
    expect(summaryContractSources).not.toContain('likeCount');
    expect(summaryContractSources).not.toContain('forkCount');
    expect(summaryContractSources).not.toContain('forkedFromId');
    expect(summaryContractSources).not.toContain('forkedFrom');
    expect(summaryContractSources).not.toContain('forks');
    expect(summaryContractSources).not.toContain('remixNote');
    expect(summaryContractSources).not.toContain('isLiked');
    expect(summaryContractSources).not.toContain('commentCount');
    expect(podcastRouteSource).not.toContain('isLiked');
    expect(podcastRouteSource).not.toContain('prisma.like');
    expect(podcastRouteSource).not.toContain('forkedFromId');
    expect(podcastRouteSource).not.toContain('forkCount');
    expect(adminPodcastRouteSource).not.toContain('forkedFromId');
    expect(adminPodcastRouteSource).not.toContain('forkCount');
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

  it('does not ship user follow or discovery social contracts', () => {
    const removedUserSocialRoutes = [
      'src/app/api/users/[userId]/follow/route.ts',
      'src/app/api/users/[userId]/followers/route.ts',
      'src/app/api/users/[userId]/following/route.ts',
      'src/app/api/users/[userId]/activity/route.ts',
      'src/app/api/users/discover/route.ts',
      'src/app/api/users/suggested/route.ts',
    ];
    const removedDiscoverySocialComponents = [
      'src/components/discovery/CreatorSuggestion.tsx',
      'src/components/discovery/CreatorSuggestion.module.css',
      'src/components/discovery/RecommendationCard.tsx',
      'src/components/discovery/RecommendationCard.module.css',
    ];
    const userApiSources = [
      'src/app/api/users/[userId]/route.ts',
      'src/app/api/users/me/route.ts',
      'src/app/api/users/me/export/route.ts',
      'src/lib/notification-utils.ts',
      'src/components/notifications/NotificationList.tsx',
      'src/components/CLAUDE.md',
    ]
      .map(readSource)
      .join('\n');
    const userValidationSources = [
      'src/lib/validations.ts',
      'src/app/api/queue/route.ts',
    ]
      .map(readSource)
      .join('\n');
    const activityWriteSources = [
      'src/app/api/podcasts/route.ts',
      'src/app/api/collections/route.ts',
    ]
      .map(readSource)
      .join('\n');

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
    expect(activityWriteSources).not.toContain('PODCAST_CREATED');
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
