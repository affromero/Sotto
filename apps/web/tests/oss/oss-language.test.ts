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

describe('open-source language-learning OSS surfaces', () => {
  const primarySurfaceFiles = [
    'src/components/layout/Sidebar.tsx',
    'src/components/layout/MobileNav.tsx',
    'src/components/layout/TopBar.tsx',
    'src/components/layout/PublicNav.tsx',
    'src/components/layout/Footer.tsx',
    'src/components/landing/LandingHeader.tsx',
    'src/components/landing/LandingCTA.tsx',
    'src/components/landing/JsonLd.tsx',
    'src/app/page.tsx',
    'src/app/(dashboard)/dashboard/page.tsx',
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

  it('ships with an AGPL-3.0 LICENSE file', () => {
    const licenseSource = readFileSync(resolve(repoRoot, 'LICENSE'), 'utf8');
    expect(existsSync(resolve(repoRoot, 'LICENSE'))).toBe(true);
    expect(licenseSource).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  });

  it('positions the product as open-source language-learning infrastructure, not a social podcast network', () => {
    const landingSource = [
      'src/app/page.tsx',
      'src/components/landing/LandingHeader.tsx',
      'src/components/landing/LandingCTA.tsx',
    ]
      .map(readSource)
      .join('\n');
    const sharedPositioningSource = [
      'packages/shared/src/brand.ts',
      'apps/web/src/lib/marketing-templates.ts',
      'apps/web/prompts/demo/walkthrough.md',
      'apps/web/public/manifest.json',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    // brand.ts must carry the new language-learning taglines
    expect(sharedPositioningSource).toContain('Learn a language, taught in your own context.');
    expect(sharedPositioningSource).toContain('Context-aware, self-hostable language learning.');

    // old social-podcast and podcast-network copy must be gone
    expect(landingSource).not.toContain('social podcast network');
    expect(landingSource).not.toContain('social feed');
    expect(landingSource).not.toContain('social features');
    expect(landingSource).not.toContain('Fork and remix any public podcast');
    expect(sharedPositioningSource).not.toContain('social podcast network');
    expect(sharedPositioningSource).not.toContain('social feed');
    expect(sharedPositioningSource).not.toContain('GitHub for podcasts');
    expect(sharedPositioningSource).not.toContain('Create. Fork. Remix. Share.');
    expect(sharedPositioningSource).not.toContain('fork and remix anything');
    expect(sharedPositioningSource).not.toContain('Every voice. Every topic. One feed.');
  });

  it('keeps public product copy free of social-network and old-brand positioning', () => {
    const webCopySources = [
      'src/app/about/page.tsx',
      'src/app/join/page.tsx',
      'src/app/developers/page.tsx',
      'src/app/terms/page.tsx',
      'src/app/privacy/page.tsx',
      'src/app/support/page.tsx',
      'src/app/layout.tsx',
      'src/app/(admin)/admin/showcase/ActionEditor.tsx',
      'src/app/(dashboard)/settings/SettingsForm.tsx',
      'src/components/referral/JoinCTA.tsx',
    ]
      .map(readSource)
      .join('\n');
    const mobileCopySources = ['apps/mobile/app/settings/referral.tsx']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const copySources = [webCopySources, mobileCopySources].join('\n');

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
    // The old podcast dashboard surfaces (DashboardStats, MyPodcastsSection) are
    // retired; /dashboard is now a redirect to /learn. Guard what remains.
    const dashboardSource = ['src/app/(dashboard)/dashboard/page.tsx'].map(readSource).join('\n');

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

  it('exposes local ingestion through MCP without public visibility controls', () => {
    const mcpSources = [
      'packages/mcp/src/server.ts',
      'packages/mcp/src/client.ts',
      'packages/mcp/src/format.ts',
      'packages/mcp/README.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(mcpSources).toContain('ingest_agent_output');
    expect(mcpSources).toContain('/api/ingest/agent');
    expect(mcpSources).toContain('tts_provider');
    expect(mcpSources).toContain('idempotency_key');
    expect(mcpSources).toContain('never publishes the result publicly');
    expect(mcpSources).toContain('formatAgentIngested');
    expect(mcpSources).not.toContain('agent_visibility');
  });

  it('requires bot and shared URL helpers to use an explicit deployment URL', () => {
    const runtimeUrlSources = [
      'src/lib/urls.ts',
    ]
      .map(readSource)
      .join('\n');

    expect(runtimeUrlSources).toContain('NEXT_PUBLIC_APP_URL or NEXTAUTH_URL is required');
    expect(runtimeUrlSources).toContain('getPublicAppBaseUrl');
    expect(runtimeUrlSources).not.toContain('https://sotto.fm');
    expect(runtimeUrlSources).not.toContain("|| 'https://sotto.fm'");
    expect(runtimeUrlSources).not.toContain("?? 'https://sotto.fm'");
    expect(runtimeUrlSources).not.toMatch(/startsWith\(['"]https:\/\/['"]\)\s*\?/);
  });

  it('requires generated absolute URLs to use explicit deployment configuration', () => {
    const generatedUrlSources = [
      'src/app/layout.tsx',
      'src/app/robots.ts',
      'src/app/sitemap.ts',
      'src/app/podcast/[podcastId]/page.tsx',
      'src/components/player/PodcastJsonLd.tsx',
      'src/components/landing/JsonLd.tsx',
      'src/app/api/oembed/route.ts',
      'src/app/api/admin/invitations/route.ts',
      'src/app/api/users/unsubscribe/route.ts',
      'src/lib/rss.ts',
      'src/lib/providers/music/suno.provider.ts',
      'src/lib/extractors/index.ts',
      'src/lib/extractors/html.ts',
      'src/lib/email-templates.ts',
      'src/components/player/EmbedPlayer.tsx',
      'src/app/(dashboard)/settings/SettingsForm.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(generatedUrlSources).toContain('getAppBaseUrl');
    expect(generatedUrlSources).not.toContain('https://sotto.fm');
    expect(generatedUrlSources).not.toContain("|| 'https://sotto.fm'");
    expect(generatedUrlSources).not.toContain("?? 'https://sotto.fm'");
    expect(generatedUrlSources).not.toContain('NEXT_PUBLIC_URL');
    expect(generatedUrlSources).not.toContain("|| 'http://localhost:3000'");
  });

  it('requires mobile and extension clients to use explicit deployment URLs', () => {
    const mobileRuntimeSources = [
      'apps/mobile/lib/config.ts',
      'apps/mobile/lib/api.ts',
      'apps/mobile/lib/event-buffer.ts',
      'apps/mobile/app/settings/referral.tsx',
      'apps/mobile/app/auth/login.tsx',
      'apps/mobile/app/settings.tsx',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const mobileBuildConfigSources = [
      'apps/mobile/app.config.js',
      'apps/mobile/app.json',
      'apps/mobile/eas.json',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const extensionSources = [
      'extension/background.js',
      'extension/popup.js',
      'extension/popup.html',
      'extension/manifest.json',
      'extension/ADAPTATION.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    // The client must point at an explicit deployment — paired at runtime
    // ("scan to connect") or baked in via EXPO_PUBLIC_API_URL — and never
    // silently default to a hosted sotto.fm. getApiBaseUrl throws when no server
    // is configured at all.
    expect(mobileRuntimeSources).toContain('No Sotto server is configured');
    expect(mobileRuntimeSources).toContain('getApiBaseUrl');
    expect(mobileRuntimeSources).not.toContain('https://sotto.fm');
    expect(mobileRuntimeSources).not.toContain("?? 'https://sotto.fm/api'");
    expect(mobileRuntimeSources).not.toContain("|| 'https://sotto.fm/api'");

    // The build is driven by the explicit EXPO_PUBLIC_API_URL knob and also
    // supports a runtime-config build (no baked-in server) — never a hardcoded host.
    expect(mobileBuildConfigSources).toContain('EXPO_PUBLIC_API_URL');
    expect(mobileBuildConfigSources).toContain('runtime-config');
    expect(mobileBuildConfigSources).not.toContain('applinks:sotto.fm');
    expect(mobileBuildConfigSources).not.toContain('"host": "sotto.fm"');
    expect(mobileBuildConfigSources).not.toContain('https://sotto.fm/api');

    expect(extensionSources).toContain('Sotto deployment URL is required');
    expect(extensionSources).toContain('SET_CONFIG');
    expect(extensionSources).toContain('"https://*/*"');
    expect(extensionSources).toContain('optional import adapter');
    expect(extensionSources).not.toContain('https://sotto.fm');
    expect(extensionSources).not.toContain('sotto.fm/api');
    expect(extensionSources).not.toContain('Send NotebookLM to Sotto');
    expect(extensionSources).not.toContain('Send NotebookLM audio overviews');
    expect(extensionSources).not.toContain('SET_API_KEY');
    expect(extensionSources).not.toContain('CLEAR_API_KEY');
  });

  it('keeps the local setup script OSS-first and template-driven', () => {
    const setupSource = readFileSync(resolve(repoRoot, 'scripts/setup.sh'), 'utf8');
    const installDepsSource = readFileSync(resolve(repoRoot, 'scripts/install-deps.sh'), 'utf8');
    const localSetupDocs = ['README.md', 'docs/23-local-development.md', '.env.oss.example']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(setupSource).toContain('ENV_TEMPLATE="$REPO_ROOT/.env.oss.example"');
    expect(setupSource).toContain('cp "$ENV_TEMPLATE" "$ENV_FILE"');
    expect(setupSource).toContain('compose up -d postgres redis');
    expect(setupSource).toContain('bash "$SCRIPT_DIR/install-deps.sh" --node --docker --ffmpeg');
    expect(setupSource).toContain('Fastest path: set OPENAI_API_KEY');
    expect(setupSource).toContain('set_env_value AUTH_SECRET "$AUTH_SECRET"');
    expect(setupSource).not.toContain('uv sync --group pitch');
    expect(setupSource).not.toContain('AI_PROVIDER="anthropic"');
    expect(setupSource).not.toContain('docker-compose up -d');
    expect(setupSource).not.toContain('doppler');
    expect(setupSource).not.toContain('set_env_value NEXTAUTH_SECRET');

    expect(installDepsSource).toContain('install_ffmpeg');
    expect(localSetupDocs).toContain('EXPO_PUBLIC_API_URL="http://localhost:3000/api"');
    expect(localSetupDocs).toContain('LOCAL_STORAGE_DIR="./.sotto/storage"');
    expect(localSetupDocs).not.toContain(
      'Compatibility scripts are still available for the old hosted setup'
    );
    expect(localSetupDocs).not.toContain('LOCAL_STORAGE_ROOT');
  });

  it('keeps root and e2e commands env-file driven without hosted secret tooling', () => {
    const packageJson = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
    const envRunner = readFileSync(resolve(repoRoot, 'scripts/run-with-env.sh'), 'utf8');
    const e2eSources = [
      'e2e/playwright/playwright.config.ts',
      'e2e/playwright/fixtures/auth.ts',
      'e2e/playwright/helpers/seed.ts',
      'e2e/maestro/config.yaml',
      'e2e/maestro/run.sh',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const agentDocs = readFileSync(resolve(repoRoot, 'AGENTS.md'), 'utf8');
    const rootClaude = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf8');
    const commandSources = [packageJson, envRunner, e2eSources].join('\n');

    expect(packageJson).toContain('"dev": "scripts/run-with-env.sh');
    expect(packageJson).toContain('"record": "scripts/run-with-env.sh');
    expect(packageJson).not.toContain('"db:sync"');
    expect(existsSync(resolve(repoRoot, 'scripts/sync-prod-db.sh'))).toBe(false);
    expect(envRunner).toContain('SOTTO_ENV_FILE');
    expect(e2eSources).toContain('scripts/run-with-env.sh');
    expect(e2eSources).toContain('test-e2e@example.com');
    expect(e2eSources).toContain('https://media.example.com/e2e/test-audio.mp3');
    expect(commandSources).not.toContain('doppler run');
    expect(commandSources).not.toContain(':doppler');
    expect(commandSources).not.toContain('@sotto.fm');
    expect(commandSources).not.toContain('https://sotto.fm');
    expect(commandSources).not.toContain('NEXTAUTH_SECRET');
    expect(agentDocs).not.toContain('uses Doppler, syncs prod DB by default');
    expect(agentDocs).not.toContain('Secrets are managed via Doppler');
    expect(rootClaude).not.toContain('Compatibility scripts for the old hosted setup');
    expect(rootClaude).not.toContain('Hosted deployments may still use Doppler');
    expect(rootClaude).toContain(
      'Critical local variables: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`'
    );
  });

  it('keeps mobile env sync local and Doppler-free by default', () => {
    const packageJson = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
    const syncMobileEnv = readFileSync(resolve(repoRoot, 'scripts/sync-mobile-env.sh'), 'utf8');
    const mobileEnvExample = readFileSync(resolve(repoRoot, 'apps/mobile/.env.example'), 'utf8');
    const mobileInstructions = readFileSync(resolve(repoRoot, 'apps/mobile/CLAUDE.md'), 'utf8');
    const mobileSetupSources = [
      packageJson,
      syncMobileEnv,
      mobileEnvExample,
      mobileInstructions,
    ].join('\n');

    expect(packageJson).toContain('"mobile:env": "bash scripts/sync-mobile-env.sh"');
    expect(syncMobileEnv).toContain('ENV_SOURCE="$REPO_ROOT/.env.local"');
    expect(syncMobileEnv).toContain('EXPO_PUBLIC_API_URL="${NEXT_PUBLIC_APP_URL%/}/api"');
    expect(syncMobileEnv).toContain('MOBILE_ENV_OUTPUT');
    expect(mobileSetupSources).toContain('EXPO_PUBLIC_API_URL');
    expect(mobileSetupSources).not.toContain('LAN_IP');
    expect(mobileSetupSources).not.toContain('auto-syncs env from Doppler');
    expect(mobileSetupSources).not.toContain("grep '^EXPO_PUBLIC_'");
    expect(mobileSetupSources).not.toContain('doppler secrets download');
    expect(mobileSetupSources).not.toContain('All `EXPO_PUBLIC_*` via **Doppler**');
  });

  it('keeps environment templates deployment-neutral', () => {
    const envExample = readFileSync(resolve(repoRoot, '.env.example'), 'utf8');
    const envOssExample = readFileSync(resolve(repoRoot, '.env.oss.example'), 'utf8');
    const envTemplateSources = [envExample, envOssExample].join('\n');

    expect(envExample).toContain('Use your own secret manager');
    expect(envExample).toContain('copy .env.oss.example to .env.local');
    expect(envExample).toContain('Use the exact public host from NEXT_PUBLIC_APP_URL');
    expect(envTemplateSources).toContain('AUTH_SECRET');
    expect(envTemplateSources).not.toContain('NEXTAUTH_SECRET');
    expect(envTemplateSources).not.toContain('dashboard.doppler.com/workplace/projects/sotto');
    expect(envTemplateSources).not.toContain('doppler secrets download');
    expect(envTemplateSources).not.toContain('doppler secrets set');
    expect(envTemplateSources).not.toContain('hello@sotto.fm');
    expect(envTemplateSources).not.toContain('Use the apex domain (sotto.fm)');
    expect(envTemplateSources).not.toContain('DNS domain verification for sotto.fm');
    expect(envTemplateSources).not.toContain('Doppler dev/prd configs');
  });

  it('uses AUTH_SECRET as the only runtime session secret', () => {
    const authSecretSources = [
      'apps/web/src/lib/auth.ts',
      'apps/web/src/middleware.ts',
      'apps/web/src/lib/email-templates.ts',
      'apps/web/src/app/api/access/route.ts',
      'apps/web/src/app/api/users/unsubscribe/route.ts',
      'apps/web/src/app/api/waitlist/unsubscribe/route.ts',
      'apps/web/src/app/api/pitch/[...path]/route.ts',
      'apps/web/src/app/api/pitch/auth/route.ts',
      'apps/web/src/workers/demo-recording.worker.ts',
      'apps/web/src/lib/health.ts',
      'scripts/capture-pitch-screenshots.ts',
      'scripts/recording/index.ts',
      'scripts/recording/lib/browser.ts',
      'scripts/recording/narrate.ts',
      'docs/17-authentication-setup.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(authSecretSources).toContain('process.env.AUTH_SECRET');
    expect(authSecretSources).toContain('AUTH_SECRET is required');
    expect(authSecretSources).not.toContain('NEXTAUTH_SECRET');
    expect(authSecretSources).not.toContain('AUTH_SECRET ??');
    expect(authSecretSources).not.toContain('AUTH_SECRET ||');
    expect(authSecretSources).not.toContain('Secret fallback');
    expect(authSecretSources).not.toContain('Legacy name');
    expect(authSecretSources).not.toContain('via Doppler');
    expect(authSecretSources).not.toContain('doppler run --');
  });

  it('keeps runtime infrastructure surfaces free of hosted defaults', () => {
    const runtimeInfraSources = [
      'packages/shared/src/brand.ts',
      'apps/maps/src/components/SottoLogo.tsx',
      'apps/maps/src/app/api/health/route.ts',
      'apps/web/src/lib/push-notifications.ts',
      'apps/web/src/lib/reference-validator.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(runtimeInfraSources).toContain("url: '/'");
    expect(runtimeInfraSources).toContain('process.env.VAPID_SUBJECT');
    expect(runtimeInfraSources).toContain('OPENALEX_EMAIL');
    expect(runtimeInfraSources).not.toContain('https://sotto.fm');
    expect(runtimeInfraSources).not.toContain('sotto.fm');
    expect(runtimeInfraSources).not.toContain('maps.sotto.fm');
    expect(runtimeInfraSources).not.toContain('mailto:hello@sotto.fm');
    expect(runtimeInfraSources).not.toContain('process.env.VAPID_SUBJECT ||');
    expect(runtimeInfraSources).not.toContain("service: 'maps.sotto.fm'");
  });

  it('keeps public contact and demo surfaces self-host neutral', () => {
    const publicContactSources = [
      'apps/web/src/app/about/page.tsx',
      'apps/web/src/app/banned/page.tsx',
      'apps/web/src/app/support/page.tsx',
      'apps/web/src/app/terms/page.tsx',
      'apps/web/src/app/privacy/page.tsx',
      'apps/web/src/app/feedback/page.tsx',
      'apps/web/src/app/join/page.tsx',
      'apps/web/src/app/api/auth/mobile/route.ts',
      'apps/web/src/app/opengraph-image.tsx',
      'apps/web/src/app/(admin)/admin/showcase/AvatarPrep.tsx',
      'apps/web/public/manifest.json',
      'apps/web/prisma/seed.ts',
      'apps/web/prisma/seed-demo.ts',
      'accounting/TODO.md',
      'accounting/docs/manual-setup.md',
      'accounting/docs/monthly-close-procedure.md',
      'accounting/ledger/main.beancount',
      'accounting/ledger/opening.beancount',
      'accounting/ledger/2026/02-february.beancount',
      'packages/maps/README.md',
      'packages/video/src/compositions/shared/SottoWatermark.tsx',
      'packages/verification-standard/package.json',
      'packages/verification-standard/README.md',
      'packages/verification-standard/CONTRIBUTING.md',
      'scripts/capture-pitch-screenshots.ts',
      'scripts/launch-video/AUTHORING_GUIDE.md',
      'scripts/launch-video/SYSTEM_PROMPT.md',
      'scripts/launch-video/sotto-launch.json',
      'scripts/recording/index.ts',
      'scripts/recording/lib/browser.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(publicContactSources).toContain('support@example.com');
    expect(publicContactSources).toContain('https://your-domain.example');
    expect(publicContactSources).toContain('https://media.example.com/demos/');
    expect(publicContactSources).not.toContain('sotto.fm');
    expect(publicContactSources).not.toContain('@sottofm');
    expect(publicContactSources).not.toContain('r2.sotto.fm');
    expect(publicContactSources).not.toContain('maps.sotto.fm');
    expect(publicContactSources).not.toContain('hello@sotto.fm');
    expect(publicContactSources).not.toContain('support@sotto.fm');
    expect(publicContactSources).not.toContain('dmca@sotto.fm');
    expect(publicContactSources).not.toContain('jobs@sotto.fm');
    expect(publicContactSources).not.toContain('teams@sotto.fm');
    expect(publicContactSources).not.toContain('demo@sotto.fm');
    expect(publicContactSources).not.toContain('admin@sotto.fm');
    expect(publicContactSources).not.toContain('system@sotto.fm');
    expect(publicContactSources).not.toContain('social podcast network');
    expect(publicContactSources).not.toContain('Every voice. Every topic. One feed.');
  });

  it('keeps bot identity configurable for self-hosted deployments', () => {
    const botIdentitySources = [
      '.env.example',
      '.env.oss.example',
      'docs/07-ai-prompts.md',
      'docs/17-authentication-setup.md',
      'docs/25-twitter-integration.md',
      'apps/web/src/app/(admin)/admin/queues/queue-metadata.ts',
      'apps/web/src/app/(dashboard)/settings/SettingsForm.tsx',
      'apps/web/src/app/changelog/page.tsx',
      'apps/web/src/app/support/page.tsx',
      'apps/web/src/components/landing/JsonLd.tsx',
      'apps/web/src/components/layout/Footer.tsx',
      'apps/web/src/lib/bot-identity.ts',
      'apps/web/src/lib/email-templates.ts',
      'apps/web/src/workers/CLAUDE.md',
      'packages/shared/src/brand.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(botIdentitySources).toContain('NEXT_PUBLIC_TWITTER_BOT_HANDLE');
    expect(botIdentitySources).toContain('NEXT_PUBLIC_TELEGRAM_BOT_USERNAME');
    expect(botIdentitySources).toContain('TWITTER_BOT_USER_ID');
    expect(botIdentitySources).toContain('your configured Twitter bot');
    expect(botIdentitySources).not.toContain('@sottofm');
    expect(botIdentitySources).not.toContain('@SottoFM');
    expect(botIdentitySources).not.toContain('@SottoFMBot');
    expect(botIdentitySources).not.toContain('SottoFMBot');
    expect(botIdentitySources).not.toContain('TWITTER_SOTTO_USER_ID');
    expect(botIdentitySources).not.toContain('TWITTER_ACCESS_TOKEN_SECRET');
    expect(botIdentitySources).not.toContain('https://x.com/sottofm');
    expect(botIdentitySources).not.toContain('https://twitter.com/SottoFM');
  });

  it('keeps system owner identity configurable for self-hosted deployments', () => {
    const systemOwnerSources = [
      '.env.example',
      '.env.oss.example',
      'apps/web/prisma/seed.ts',
      'apps/web/src/lib/system-user.ts',
      'apps/web/src/workers/CLAUDE.md',
      'apps/web/src/app/api/admin/podcasts/create-as-system-owner/route.ts',
      'apps/web/src/app/api/admin/landing-showcase/bootstrap/route.ts',
      'apps/web/src/app/api/admin/impersonate/targets/route.ts',
      'apps/web/src/app/(admin)/admin/podcasts/CreateAsSystemOwnerButton.tsx',
      'apps/web/src/app/(admin)/admin/podcasts/page.tsx',
      'apps/web/src/app/(admin)/admin/podcasts/page.module.css',
      'apps/web/src/components/layout/AccountSwitcher.tsx',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(systemOwnerSources).toContain('SYSTEM_USER_HANDLE');
    expect(systemOwnerSources).toContain('SYSTEM_USER_EMAIL');
    expect(systemOwnerSources).toContain('create-as-system-owner');
    expect(systemOwnerSources).toContain('configured system owner');
    expect(
      existsSync(resolve(repoRoot, 'apps/web/src/app/api/admin/podcasts/create-as-sotto'))
    ).toBe(false);
    expect(systemOwnerSources).not.toContain("handle: 'sotto'");
    expect(systemOwnerSources).not.toContain('create-as-sotto');
    expect(systemOwnerSources).not.toContain('as=sotto');
    expect(systemOwnerSources).not.toContain('Create as @sotto');
    expect(systemOwnerSources).not.toContain('as if tagging @sotto');
    expect(systemOwnerSources).not.toContain('official Sotto account');
    expect(systemOwnerSources).not.toContain('@sotto system account');
    expect(systemOwnerSources).not.toContain('sottoUser');
    expect(systemOwnerSources).not.toContain('sottoDropdown');
  });

  it('keeps public project and verification links configurable', () => {
    const publicLinkSources = [
      '.env.example',
      '.env.oss.example',
      'apps/web/src/lib/public-links.ts',
      'apps/web/src/components/player/ReferenceList.tsx',
      'apps/web/src/components/create/GenerationProgress.tsx',
      'scripts/recording/flows/07-verification-github.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(publicLinkSources).toContain('NEXT_PUBLIC_GITHUB_URL');
    expect(publicLinkSources).toContain('NEXT_PUBLIC_DISCORD_URL');
    expect(publicLinkSources).toContain('NEXT_PUBLIC_VERIFICATION_STANDARD_URL');
    expect(publicLinkSources).not.toContain('https://github.com/SottoFM');
    expect(publicLinkSources).not.toContain('https://discord.gg/sotto');
  });

  it('uses the neutral verification workspace namespace', () => {
    const verificationNamespaceSources = [
      'apps/web/package.json',
      'apps/web/next.config.js',
      'apps/web/src/lib/CLAUDE.md',
      'apps/web/src/lib/reference-verification/ai-layer.ts',
      'apps/web/src/lib/reference-verification/grounding.ts',
      'apps/web/src/lib/reference-verification/pipeline.ts',
      'CLAUDE.md',
      'package-lock.json',
      'packages/verification-standard/package.json',
      'packages/verification-standard/package-lock.json',
      'packages/verification-standard/.github/workflows/release.yml',
      'packages/verification-standard/README.md',
      'packages/verification-standard/CONTRIBUTING.md',
      'packages/verification-standard/CHANGELOG.md',
      'packages/verification-standard/LICENSE',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(verificationNamespaceSources).toContain('@sotto/verification-standard');
    expect(verificationNamespaceSources).not.toContain('@sottofm/verification-standard');
    expect(verificationNamespaceSources).not.toContain('github.com/SottoFM');
    expect(verificationNamespaceSources).not.toContain('SottoFM');
  });

  it('keeps security and operations guidance self-host neutral', () => {
    const releaseHygieneSources = [
      'SECURITY.md',
      'scripts/generate-apple-secret.mjs',
      'docs/05-plan.md',
      'docs/23-local-development.md',
      'docs/27-launch-readiness-status.md',
      'apps/maps/CLAUDE.md',
      'apps/web/scripts/test-runway-browser.ts',
      'apps/web/scripts/test-runway-native.ts',
      'apps/web/src/app/(admin)/admin/storage/page.tsx',
      'apps/web/src/lib/CLAUDE.md',
      'apps/web/src/lib/providers/video.ts',
      'packages/maps/CLAUDE.md',
      'packages/maps/README.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(releaseHygieneSources).toContain('security@example.com');
    expect(releaseHygieneSources).toContain('AUTH_SECRET="<generated>"');
    expect(releaseHygieneSources).toContain('SOTTO_ENV_FILE');
    expect(releaseHygieneSources).toContain('scripts/run-with-env.sh');
    expect(releaseHygieneSources).toContain('secret manager or env file');
    expect(releaseHygieneSources).toContain('Set in your deployment environment:');
    expect(releaseHygieneSources).not.toContain('security@sotto.fm');
    expect(releaseHygieneSources).not.toContain('sotto.fm/api');
    expect(releaseHygieneSources).not.toContain('NEXTAUTH_SECRET');
    expect(releaseHygieneSources).not.toContain('.env.workers.local');
    expect(releaseHygieneSources).not.toContain('Set in Doppler');
    expect(releaseHygieneSources).not.toContain('doppler run --project');
    expect(releaseHygieneSources).not.toContain('add <code>CF_API_TOKEN</code> to Doppler');
    expect(releaseHygieneSources).not.toContain('Set HERA_API_KEY in Doppler');
    expect(releaseHygieneSources).not.toContain('maps.sotto.fm');
    expect(releaseHygieneSources).not.toContain('All managed via Doppler');
    expect(releaseHygieneSources).not.toContain('Env vars (Doppler)');
    expect(releaseHygieneSources).not.toContain('through Doppler');
    expect(releaseHygieneSources).not.toContain('| Doppler |');
  });

  it('keeps server deployment self-hosted and env-file driven', () => {
    const deploySource = readFileSync(resolve(repoRoot, 'scripts/deploy.sh'), 'utf8');
    const setupServerSource = readFileSync(resolve(repoRoot, 'scripts/setup-server.sh'), 'utf8');
    const caddyTemplate = readFileSync(resolve(repoRoot, 'Caddyfile'), 'utf8');
    const deploymentSources = [deploySource, setupServerSource, caddyTemplate].join('\n');

    expect(deploySource).toContain('ENV_FILE="${SOTTO_ENV_FILE:-$REPO_ROOT/.env.production}"');
    expect(deploySource).toContain('require_env NEXT_PUBLIC_APP_URL');
    expect(deploySource).toContain('render_caddy_config');
    expect(deploySource).toContain(
      'CADDY_SITE_PATH="${CADDY_SITE_PATH:-/etc/caddy/conf.d/sotto.conf}"'
    );
    expect(setupServerSource).toContain('cp .env.example .env.production');
    expect(setupServerSource).toContain(
      'SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh'
    );
    expect(caddyTemplate).toContain('__SOTTO_APP_DOMAIN__');
    expect(caddyTemplate).toContain('# BEGIN_OPTIONAL_MAPS');
    expect(caddyTemplate).toContain('# BEGIN_OPTIONAL_WWW');
    expect(deploymentSources).not.toContain('doppler');
    expect(deploymentSources).not.toContain('Doppler');
    expect(deploymentSources).not.toContain('dashboard.doppler.com');
    expect(deploymentSources).not.toContain('sotto.fm');
    expect(deploymentSources).not.toContain('/etc/caddy/conf.d/sotto.fm');
    expect(deploymentSources).not.toContain('.env.workers.local');
  });

  it('keeps release deployment docs self-host neutral', () => {
    const releaseDocs = [
      'docs/17-authentication-setup.md',
      'docs/18-hosting-infrastructure.md',
      'docs/19-self-host-deployment.md',
      'docs/24-ios-testflight-appstore-guide.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const releaseIndexSources = ['docs/CLAUDE.md', 'scripts/rebuild-pitch.sh']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(releaseDocs).toContain('your-domain.example');
    expect(releaseDocs).toContain('SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh');
    expect(releaseDocs).toContain('docker-compose.infra.yml');
    expect(releaseDocs).toContain('docker-compose.app.yml');
    expect(releaseDocs).toContain('docker-compose.workers.yml');
    expect(releaseDocs).not.toContain('https://sotto.fm');
    expect(releaseDocs).not.toContain('sotto.fm');
    expect(releaseDocs).not.toContain('dashboard.doppler.com');
    expect(releaseDocs).not.toContain('doppler secrets');
    expect(releaseDocs).not.toContain('docker-compose.prod.yml');
    expect(releaseIndexSources).toContain('19-self-host-deployment.md');
    expect(releaseIndexSources).not.toContain('19-deploy-sotto-fm.md');
  });

  it('does not ship the standalone social feed ranking workspace', () => {
    const workspaceSources = [
      'package.json',
      'package-lock.json',
      'apps/web/package.json',
      'apps/web/next.config.js',
      'apps/web/Dockerfile',
      'apps/web/Dockerfile.workers',
      'apps/web/src/workers/feature-computation.worker.ts',
      'apps/web/src/lib/CLAUDE.md',
      'CHANGELOG.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(existsSync(resolve(repoRoot, 'packages/feed'))).toBe(false);
    expect(workspaceSources).not.toContain('@sottofm/feed');
    expect(workspaceSources).not.toContain('@sottofm');
    expect(workspaceSources).not.toContain('packages/feed');
    expect(workspaceSources).not.toContain('public podcast feed');
    expect(workspaceSources).not.toContain('FollowButton');
    expect(workspaceSources).not.toContain('users/[userId]/follow');
    expect(workspaceSources).not.toContain('podcasts/[podcastId]/like');
    expect(workspaceSources).not.toContain('podcasts/[podcastId]/fork');
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
    const podcastCardSource = ['src/components/landing/chapters/AudioClipPlayer.tsx']
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
      'apps/web/src/app/welcome/WelcomeFlow.tsx',
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

  it('keeps onboarding setup explicit about transcription readiness', () => {
    const setupSources = [
      'apps/web/src/lib/setup-readiness.ts',
      'apps/web/src/app/api/onboarding/readiness/route.ts',
      'apps/web/prisma/schema.prisma',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(setupSources).toContain("id: 'stt'");
    expect(setupSources).toContain("id: 'agent-ingestion'");
    expect(setupSources).toContain('STT_PROVIDER');
    expect(setupSources).toContain('buildSttProviderStatuses');
    expect(setupSources).toContain('Transcript ingestion works without STT');
    expect(setupSources).toContain('required: false');
    expect(setupSources).toContain('required for imported audio without transcript');
    expect(setupSources).not.toContain("stored === 'openai' ? undefined");
    expect(setupSources).not.toContain('sttProvider      String? // null = auto');
  });

  it('keeps voice generation on concrete TTS provider options', () => {
    const ttsSources = [
      'apps/web/src/app/api/podcasts/route.ts',
      'apps/web/src/app/api/tts-options/route.ts',
      'apps/web/prisma/schema.prisma',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(ttsSources).toContain('optionsById');
    expect(ttsSources).toContain('resolveTtsIncludedModels');
    expect(ttsSources).not.toContain('ttsProvider      String? // null = auto');
    expect(ttsSources).not.toContain("id: 'auto'");
  });

  it('keeps release docs aligned with open-source language-learning strategy', () => {
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
    expect(releaseDocsSource).toContain('Learn a language, taught in your own context.');
    expect(releaseDocsSource).toContain('language-learning infrastructure');
    expect(releaseDocsSource).toContain('implicit provider fallback');
    expect(releaseDocsSource).toContain('self-hosted paths');
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
    // The per-podcast creator analytics page is retired (redirects to /learn); the
    // private-activity guard now covers the analytics lib + API route it backed.
    const podcastAnalyticsSources = [
      'src/lib/podcast-analytics.ts',
      'src/app/api/podcasts/[podcastId]/analytics/route.ts',
    ]
      .map(readSource)
      .join('\n');

    expect(podcastAnalyticsSources).toContain('getPodcastPrivateActivity');
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

  it('does not ship the podcast recommendation engine or feed', () => {
    const removedRecommendationPaths = [
      'apps/web/src/lib/recommendation-engine.ts',
      'apps/web/src/lib/recommendations.ts',
      'apps/web/src/lib/recommendation-metrics.ts',
      'apps/web/src/app/api/recommendations',
      'apps/web/src/app/api/picks',
      'apps/web/src/app/api/users/me/recommendations',
      'apps/web/src/app/api/inspire/all',
      'apps/web/src/app/(admin)/admin/recommendations',
    ];
    for (const path of removedRecommendationPaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    expect(schemaSource).not.toContain('model RecommendationLog');
  });

  it('keeps live podcast status and voice tracks owner-gated', () => {
    const livePodcastSources = ['src/app/api/podcasts/[podcastId]/voice-tracks/route.ts']
      .map(readSource)
      .join('\n');

    expect(livePodcastSources).toContain("errorResponse('Unauthorized', 401)");
    expect(livePodcastSources).toContain('podcast.userId !== userId');
    expect(livePodcastSources).not.toContain('No auth required');
    expect(livePodcastSources).not.toContain('Auth is optional');
    expect(livePodcastSources).not.toContain('public podcasts visible to all');
    expect(livePodcastSources).not.toContain("visibility === 'PRIVATE'");
  });

  it('keeps local ingestion surfaces authenticated and private-only', () => {
    const agentIngestRouteSource = readSource('src/app/api/ingest/agent/route.ts');
    const privateIngestionSource = readSource('src/lib/private-ingestion.ts');
    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    const sharedEnumsSource = readFileSync(
      resolve(repoRoot, 'packages/shared/src/types/enums.ts'),
      'utf8'
    );

    expect(agentIngestRouteSource).toContain('authenticateRequest(request)');
    expect(agentIngestRouteSource).toContain("errorResponse('Unauthorized', 401)");
    expect(agentIngestRouteSource).toContain("source: 'AGENT'");
    expect(agentIngestRouteSource).toContain('createPrivateIngestionPodcast');
    expect(privateIngestionSource).toContain("visibility: 'PRIVATE'");
    expect(agentIngestRouteSource).toContain('agentIngestion.create');
    expect(agentIngestRouteSource).toContain('idempotencyKey');
    expect([agentIngestRouteSource, privateIngestionSource].join('\n')).not.toContain(
      "visibility: 'PUBLIC'"
    );
    expect([agentIngestRouteSource, privateIngestionSource].join('\n')).not.toContain(
      "visibility: 'UNLISTED'"
    );
    expect(agentIngestRouteSource).not.toContain('public feed');
    expect(schemaSource).toContain('model AgentIngestion');
    expect(schemaSource).toContain('AGENT');
    expect(sharedEnumsSource).toContain("| 'AGENT'");
  });

  it('keeps workspace connector onboarding private and explicit', () => {
    const sourceConnectorSource = readSource('src/lib/source-connectors.ts');
    const sourceConnectorRouteSource = readSource(
      'src/app/api/source-connectors/readiness/route.ts'
    );
    const onboardingSources = [
      readSource('src/app/welcome/steps/StepContext.tsx'),
      sourceConnectorSource,
      sourceConnectorRouteSource,
      readFileSync(resolve(repoRoot, '.env.example'), 'utf8'),
    ].join('\n');

    expect(sourceConnectorRouteSource).toContain('authenticateRequest(request)');
    expect(sourceConnectorRouteSource).toContain("errorResponse('Unauthorized', 401)");
    expect(sourceConnectorSource).toContain("id: 'slack'");
    expect(sourceConnectorSource).toContain("id: 'gmail'");
    expect(sourceConnectorSource).toContain("id: 'claude-code'");
    expect(sourceConnectorSource).toContain("id: 'codex'");
    expect(sourceConnectorSource).toContain('google-workspace-cli');
    expect(sourceConnectorSource).toContain("command: 'gws'");
    expect(sourceConnectorSource).toContain("command: 'claude'");
    expect(sourceConnectorSource).toContain("command: 'codex'");
    expect(sourceConnectorSource).toContain('SLACK_BOT_TOKEN');
    expect(sourceConnectorSource).toContain('GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE');
    expect(onboardingSources).toContain('Nothing leaves your machine');
    expect(onboardingSources).toContain('privateOnly: true');
    expect(onboardingSources).not.toContain("visibility: 'PUBLIC'");
    expect(onboardingSources).not.toContain('shared content feed');
    expect(onboardingSources).not.toContain('public workspace connector');
  });

  it('requires explicit provider selection for BYOK key deletion', () => {
    const byokSources = [
      'src/app/api/settings/byok/route.ts',
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
    const voiceProviderSources = ['src/app/api/voices/route.ts', 'tests/api/voices.test.ts']
      .map(readSource)
      .join('\n');

    expect(voiceProviderSources).toContain("errorResponse('Invalid provider', 400)");
    expect(voiceProviderSources).toContain('rejects invalid provider param');
    expect(voiceProviderSources).not.toContain(
      'falls back to elevenlabs for invalid provider param'
    );
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
    const mcpSources = ['packages/mcp/src/types.ts', 'packages/mcp/src/format.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const privateContractSources = [trafficReportSource, mcpSources].join('\n');

    expect(trafficReportSource).toContain('PrivateActivitySection');
    expect(trafficReportSource).toContain('privateActivity');
    expect(trafficReportSource).toContain('topSaved');
    expect(privateContractSources).not.toContain('EngagementSection');
    expect(privateContractSources).not.toContain('collectionFollow');
    expect(privateContractSources).not.toContain('followerCount');
    expect(privateContractSources).not.toContain('followingCount');
    expect(privateContractSources).not.toContain('likeCount');
    expect(privateContractSources).not.toContain('forkCount');
    expect(privateContractSources).not.toContain('forkedFromId');
    expect(privateContractSources).not.toContain('isLiked');
    expect(privateContractSources).not.toContain('Forked from');
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
      'src/app/podcast/[podcastId]/page.tsx',
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

  it('keeps mobile e2e flows aligned to private library contracts', () => {
    const maestroFlowDir = resolve(repoRoot, 'e2e/maestro/flows');
    const removedSocialFlows = [
      '02-feed-browse.yaml',
      '09-fork.yaml',
      '15-user-profile.yaml',
      '25-error-empty-feed.yaml',
      '30-comments.yaml',
    ];
    const maestroSources = [
      ...readdirSync(maestroFlowDir)
        .filter((file) => file.endsWith('.yaml'))
        .map((file) => readFileSync(resolve(maestroFlowDir, file), 'utf8')),
      readFileSync(resolve(repoRoot, 'e2e/maestro/config.yaml'), 'utf8'),
      readFileSync(resolve(repoRoot, 'e2e/maestro/helpers/login.yaml'), 'utf8'),
    ].join('\n');

    for (const flow of removedSocialFlows) {
      expect(existsSync(resolve(maestroFlowDir, flow)), flow).toBe(false);
    }
    expect(maestroSources).toContain('library-podcast-list');
    expect(maestroSources).toContain('library-filter-all');
    expect(maestroSources).not.toContain('feed-podcast-list');
    expect(maestroSources).not.toContain('feed-mode-');
    expect(maestroSources).not.toContain('feed-sort-');
    expect(maestroSources).not.toContain('search-mode-people');
    expect(maestroSources).not.toContain('comments-section');
    expect(maestroSources).not.toContain('player-like-button');
    expect(maestroSources).not.toContain('player-fork-button');
    expect(maestroSources).not.toContain('fork-angle-input');
    expect(maestroSources).not.toContain('user-profile-follow-button');
    expect(maestroSources).not.toContain('collection-detail-follow-button');
    expect(maestroSources).not.toContain('E2E_OTHER_USER_HANDLE');
  });

  it('does not require public demo podcasts for screenshot capture', () => {
    const pitchScreenshotSource = readFileSync(
      resolve(repoRoot, 'scripts/capture-pitch-screenshots.ts'),
      'utf8'
    );

    expect(pitchScreenshotSource).toContain('Find a READY demo podcast');
    expect(pitchScreenshotSource).not.toContain("visibility: 'PUBLIC'");
  });

  it('does not ship the curated-playlist collections feature', () => {
    const removedCollectionPaths = [
      'apps/web/src/app/api/collections',
      'apps/web/src/app/collections',
      'apps/web/src/components/collections',
      'apps/mobile/app/collections',
      'apps/mobile/components/AddToCollectionSheet.tsx',
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
      'src/app/api/users/me/route.ts',
      'src/app/api/users/me/export/route.ts',
      'src/lib/notification-utils.ts',
      'src/components/notifications/NotificationList.tsx',
      'src/components/CLAUDE.md',
    ]
      .map(readSource)
      .join('\n');
    const userValidationSources = ['src/lib/validations.ts', 'src/app/api/queue/route.ts']
      .map(readSource)
      .join('\n');
    const activityWriteSources = ['src/app/api/podcasts/route.ts']
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

  it('keeps voice sharing user lookup explicit instead of directory-style search', () => {
    const userSearchRouteSource = readSource('src/app/api/users/search/route.ts');
    const validationSource = readSource('src/lib/validations.ts');
    const userLookupSources = [userSearchRouteSource, validationSource].join('\n');

    expect(userSearchRouteSource).toContain('prisma.user.findUnique');
    expect(userSearchRouteSource).toContain('where: { handle: parsed.data.handle }');
    expect(userSearchRouteSource).toContain('select: {');
    expect(userSearchRouteSource).toContain('handle: true');
    expect(validationSource).toContain('handle: handleSchema');
    expect(userLookupSources).not.toContain('prisma.user.findMany');
    expect(userLookupSources).not.toContain('contains: parsed.data.handle');
    expect(userLookupSources).not.toContain("mode: 'insensitive'");
    expect(userLookupSources).not.toContain('Search by @handle');
  });

  it('does not ship the voice marketplace', () => {
    const removedMarketplacePaths = [
      'apps/web/src/lib/voice-pricing.ts',
      'apps/web/src/lib/revenue-metrics.ts',
      'apps/web/src/app/api/voices/request',
      'apps/web/src/app/api/voices/allowlist',
      'apps/web/src/app/api/stripe/connect',
      'apps/web/src/app/api/stripe/payment-intent',
      'apps/web/src/app/(admin)/admin/revenue',
      'apps/mobile/app/voices.tsx',
      'e2e/maestro/flows/21-voice-marketplace.yaml',
    ];
    for (const path of removedMarketplacePaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    expect(schemaSource).not.toContain('model VoiceRequest');
    expect(schemaSource).not.toContain('model VoicePurchase');
    expect(schemaSource).not.toContain('model VoiceAllowlist');

    // The shared voice directory still redirects to /learn; voice notifications route to settings.
    expect(readSource('src/app/voices/page.tsx')).toContain("redirect('/learn')");
    const voiceNotificationSource = readSource('src/lib/notification-utils.ts');
    expect(voiceNotificationSource).toContain("return '/settings/voices'");
    expect(voiceNotificationSource).not.toContain("return '/voices'");

    // Mobile settings no longer exposes a voice marketplace or a /voices route.
    const mobileSettingsSource = readFileSync(
      resolve(repoRoot, 'apps/mobile/app/settings.tsx'),
      'utf8'
    );
    expect(mobileSettingsSource).not.toContain('Voice Marketplace');
    expect(mobileSettingsSource).not.toContain("router.push('/voices')");
    const mobileLayoutSource = readFileSync(
      resolve(repoRoot, 'apps/mobile/app/_layout.tsx'),
      'utf8'
    );
    expect(mobileLayoutSource).not.toContain('Stack.Screen name="voices"');
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
      'src/app/api/users/[userId]/route.ts',
      'src/app/api/users/[userId]/collections/route.ts',
      'src/app/api/users/[userId]/rss/route.ts',
      'src/app/api/users/handle/[handle]/rss/route.ts',
    ];
    const removedPublicProfileTests = ['apps/web/tests/api/users-profile.test.ts'];
    const publicProfileSources = [
      'src/app/profile/page.tsx',
      'src/lib/urls.ts',
      'src/lib/rss.ts',
      'src/lib/CLAUDE.md',
      'src/app/api/oembed/route.ts',
      'src/app/sitemap.ts',
      'src/components/player/Contributors.tsx',
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
    expect(publicProfileSources).not.toContain('/api/users/[id]');
    expect(publicProfileSources).not.toContain('/api/users/[id]/collections');
    expect(publicProfileSources).not.toContain('/api/users/[id]/activity');
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
