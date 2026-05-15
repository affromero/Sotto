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
});
