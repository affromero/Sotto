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
    'src/components/layout/PublicNav.tsx',
    'src/components/layout/Footer.tsx',
    'src/components/landing/LandingHeader.tsx',
    'src/components/landing/LandingCTA.tsx',
    'src/components/landing/JsonLd.tsx',
    'src/app/page.tsx',
    'src/app/(dashboard)/dashboard/page.tsx',
    'src/app/episode/[episodeId]/EpisodePlayerView.tsx',
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

  it('positions the product as open-source language-learning infrastructure, not a social episode network', () => {
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

    // brand.ts must carry the new language-learning positioning
    expect(sharedPositioningSource).toContain('Learn a language, taught in your own context.');
    expect(sharedPositioningSource).toContain('Open-source, self-hostable courses');

    // old social-episode and episode-network copy must be gone
    expect(landingSource).not.toContain('social episode network');
    expect(landingSource).not.toContain('social feed');
    expect(landingSource).not.toContain('social features');
    expect(landingSource).not.toContain('Fork and remix any public episode');
    expect(sharedPositioningSource).not.toContain('social episode network');
    expect(sharedPositioningSource).not.toContain('social feed');
    expect(sharedPositioningSource).not.toContain('GitHub for episodes');
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
      'src/app/(dashboard)/settings/SettingsForm.tsx',
    ]
      .map(readSource)
      .join('\n');
    const copySources = webCopySources;

    expect(copySources).not.toContain('social episode network');
    expect(copySources).not.toContain('social feed');
    expect(copySources).not.toContain('social features');
    expect(copySources).not.toContain('social graph');
    expect(copySources).not.toContain('open episode network');
    expect(copySources).not.toContain('Fork and remix');
    expect(copySources).not.toContain('fork and remix');
    expect(copySources).not.toContain('Forking');
    expect(copySources).not.toContain('forked version');
    expect(copySources).not.toContain('likes, and follows');
    expect(copySources).not.toContain('followerCount');
  });

  it('keeps dashboard data access scoped to private workspace metrics', () => {
    // The old episode dashboard surfaces (DashboardStats, MyEpisodesSection) are
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
    expect(readSource('src/app/episode/[episodeId]/EpisodePlayerView.tsx')).not.toContain(
      'canMakePrivate'
    );
  });

  it('does not ship the public feed page or feed API route', () => {
    expect(existsSync(resolve(webRoot, 'src/app/feed/page.tsx'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/app/api/v1/feed/route.ts'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/app/api/v1/activity/route.ts'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/components/feed/ActivityFeed.tsx'))).toBe(false);
    expect(existsSync(resolve(webRoot, 'src/components/feed/ActivityItem.tsx'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'e2e/playwright/tests/feed.spec.ts'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'e2e/playwright/tests/api/feed-social.api.spec.ts'))).toBe(
      false
    );
  });

  it('does not keep public feed contracts in shared or MCP packages', () => {
    const mcpSources = ['packages/mcp/src/server.ts', 'packages/mcp/src/client.ts']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    expect(mcpSources).not.toContain('browse_feed');
    expect(mcpSources).not.toContain('/api/v1/feed');
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
    expect(mcpSources).toContain('/api/v1/ingest/agent');
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

    expect(runtimeUrlSources).toContain('NEXT_PUBLIC_APP_URL is required');
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
      'src/app/episode/[episodeId]/page.tsx',
      'src/components/landing/JsonLd.tsx',
      'src/lib/extractors/index.ts',
      'src/lib/extractors/html.ts',
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

  it('keeps the local setup script OSS-first and template-driven', () => {
    const setupSource = readFileSync(resolve(repoRoot, 'scripts/setup.sh'), 'utf8');
    const installDepsSource = readFileSync(resolve(repoRoot, 'scripts/install-deps.sh'), 'utf8');
    const localSetupDocs = ['README.md', 'docs/04-local-development.md', '.env.oss.example']
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(setupSource).toContain('ENV_TEMPLATE="$REPO_ROOT/.env.oss.example"');
    expect(setupSource).toContain('cp "$ENV_TEMPLATE" "$ENV_FILE"');
    expect(setupSource).toContain('compose up -d postgres redis');
    expect(setupSource).toContain('bash "$SCRIPT_DIR/install-deps.sh" --node --docker --ffmpeg');
    expect(setupSource).toContain('Fastest path: set OPENAI_API_KEY');
    expect(setupSource).not.toContain('uv sync --group pitch');
    expect(setupSource).not.toContain('AI_PROVIDER="anthropic"');
    expect(setupSource).not.toContain('docker-compose up -d');
    expect(setupSource).not.toContain('doppler');
    expect(setupSource).not.toContain('set_env_value NEXTAUTH_SECRET');

    expect(installDepsSource).toContain('install_ffmpeg');
    expect(localSetupDocs).toContain('LOCAL_STORAGE_DIR="./.sotto/storage"');
    expect(localSetupDocs).not.toContain(
      'Compatibility scripts are still available for the old hosted setup'
    );
    expect(localSetupDocs).not.toContain('LOCAL_STORAGE_ROOT');
  });

  it('keeps root and e2e commands env-file driven without hosted secret tooling', () => {
    const packageJson = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
    const envRunner = readFileSync(resolve(repoRoot, 'scripts/run-with-env.sh'), 'utf8');
    const agentDocs = readFileSync(resolve(repoRoot, 'AGENTS.md'), 'utf8');
    const rootClaude = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf8');
    const commandSources = [packageJson, envRunner].join('\n');

    expect(packageJson).toContain('"dev": "scripts/run-with-env.sh');
    expect(packageJson).not.toContain('"record": "scripts/run-with-env.sh');
    expect(packageJson).not.toContain('"narrate": "scripts/run-with-env.sh');
    expect(packageJson).not.toContain('"db:sync"');
    expect(existsSync(resolve(repoRoot, 'scripts/sync-prod-db.sh'))).toBe(false);
    expect(envRunner).toContain('SOTTO_ENV_FILE');
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
      'Critical local variables: `DATABASE_URL`, `REDIS_URL`, `BYOK_ENCRYPTION_KEY`'
    );
  });

  it('keeps environment templates deployment-neutral', () => {
    const envExample = readFileSync(resolve(repoRoot, '.env.example'), 'utf8');
    const envOssExample = readFileSync(resolve(repoRoot, '.env.oss.example'), 'utf8');
    const envTemplateSources = [envExample, envOssExample].join('\n');

    expect(envExample).toContain('Use your own secret manager');
    expect(envExample).toContain('copy .env.oss.example to .env.local');
    expect(envTemplateSources).not.toContain('NEXTAUTH_SECRET');
    expect(envTemplateSources).not.toContain('dashboard.doppler.com/workplace/projects/sotto');
    expect(envTemplateSources).not.toContain('doppler secrets download');
    expect(envTemplateSources).not.toContain('doppler secrets set');
    expect(envTemplateSources).not.toContain('hello@sotto.fm');
    expect(envTemplateSources).not.toContain('Use the apex domain (sotto.fm)');
    expect(envTemplateSources).not.toContain('DNS domain verification for sotto.fm');
    expect(envTemplateSources).not.toContain('Doppler dev/prd configs');
  });

  it('keeps runtime infrastructure surfaces free of hosted defaults', () => {
    const runtimeInfraSources = [
      'packages/shared/src/brand.ts',
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
      'apps/web/src/app/support/page.tsx',
      'apps/web/src/app/terms/page.tsx',
      'apps/web/src/app/privacy/page.tsx',
      'apps/web/src/app/feedback/page.tsx',
      'apps/web/src/app/join/page.tsx',
      'apps/web/src/app/opengraph-image.tsx',
      'apps/web/public/manifest.json',
      'apps/web/prisma/seed.ts',
      'apps/web/prisma/seed-demo.ts',
      'accounting/TODO.md',
      'accounting/docs/manual-setup.md',
      'accounting/docs/monthly-close-procedure.md',
      'accounting/ledger/main.beancount',
      'accounting/ledger/opening.beancount',
      'accounting/ledger/2026/02-february.beancount',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(publicContactSources).toContain('support@example.com');
    expect(publicContactSources).toContain('https://your-domain.example');
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
    expect(publicContactSources).not.toContain('social episode network');
    expect(publicContactSources).not.toContain('Every voice. Every topic. One feed.');
  });

  it('keeps removed bot identity config out of self-hosted deployments', () => {
    const removedBotSources = [
      '.env.example',
      '.env.oss.example',
      'apps/web/src/app/(admin)/admin/queues/queue-metadata.ts',
      'apps/web/src/app/(dashboard)/settings/SettingsForm.tsx',
      'apps/web/src/app/support/page.tsx',
      'apps/web/src/components/landing/JsonLd.tsx',
      'apps/web/src/components/layout/Footer.tsx',
      'apps/web/src/workers/CLAUDE.md',
      'packages/shared/src/brand.ts',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(removedBotSources).not.toContain('NEXT_PUBLIC_TWITTER_BOT_HANDLE');
    expect(removedBotSources).not.toContain('NEXT_PUBLIC_TELEGRAM_BOT_USERNAME');
    expect(removedBotSources).not.toContain('TWITTER_BOT_USER_ID');
    expect(removedBotSources).not.toContain('TELEGRAM_BOT_TOKEN');
    expect(removedBotSources).not.toContain('your configured Twitter bot');
    expect(removedBotSources).not.toContain('your Telegram bot');
    expect(removedBotSources).not.toContain('@sottofm');
    expect(removedBotSources).not.toContain('@SottoFM');
    expect(removedBotSources).not.toContain('@SottoFMBot');
    expect(removedBotSources).not.toContain('SottoFMBot');
    expect(removedBotSources).not.toContain('TWITTER_SOTTO_USER_ID');
    expect(removedBotSources).not.toContain('TWITTER_ACCESS_TOKEN_SECRET');
    expect(removedBotSources).not.toContain('https://x.com/sottofm');
    expect(removedBotSources).not.toContain('https://twitter.com/SottoFM');
  });

  it('keeps public project and verification links configurable', () => {
    const publicLinkSources = [
      '.env.example',
      '.env.oss.example',
      'apps/web/src/lib/public-links.ts',
      'apps/web/src/components/player/ReferenceList.tsx',
      'apps/web/src/components/create/GenerationProgress.tsx',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(publicLinkSources).toContain('NEXT_PUBLIC_GITHUB_URL');
    expect(publicLinkSources).toContain('NEXT_PUBLIC_DISCORD_URL');
    expect(publicLinkSources).toContain('NEXT_PUBLIC_VERIFICATION_STANDARD_URL');
    expect(publicLinkSources).not.toContain('https://github.com/SottoFM');
    expect(publicLinkSources).not.toContain('https://discord.gg/sotto');
  });

  it('vendors the renamed groundcheck library, free of legacy @sotto and SottoFM names', () => {
    const namespaceFiles = [
      'apps/web/package.json',
      'apps/web/next.config.js',
      'apps/web/src/lib/CLAUDE.md',
      'apps/web/src/lib/reference-verification/ai-layer.ts',
      'apps/web/src/lib/reference-verification/grounding.ts',
      'apps/web/src/lib/reference-verification/pipeline.ts',
      'CLAUDE.md',
      'package-lock.json',
      'packages/groundcheck/package.json',
      'packages/groundcheck/package-lock.json',
      'packages/groundcheck/.github/workflows/release.yml',
      'packages/groundcheck/README.md',
      'packages/groundcheck/CONTRIBUTING.md',
      'packages/groundcheck/CHANGELOG.md',
      'packages/groundcheck/LICENSE',
    ];

    const verificationSources = namespaceFiles
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    // The library was renamed to the unscoped `groundcheck` package and moved to
    // affromero/groundcheck. The legacy @sotto / @sottofm package names and the
    // former SottoFM org must not linger anywhere, including the vendored copy.
    expect(verificationSources).toContain('groundcheck');
    expect(verificationSources).not.toContain('@sotto/verification-standard');
    expect(verificationSources).not.toContain('@sottofm/verification-standard');
    expect(verificationSources).not.toContain('github.com/SottoFM');
    expect(verificationSources).not.toContain('SottoFM');
  });

  it('keeps security and operations guidance self-host neutral', () => {
    const releaseHygieneSources = [
      'SECURITY.md',
      'CLAUDE.md',
      'docs/04-local-development.md',
      'apps/web/src/lib/CLAUDE.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(releaseHygieneSources).toContain('security/advisories/new');
    expect(releaseHygieneSources).not.toContain('security@example.com');
    expect(releaseHygieneSources).toContain('SOTTO_ENV_FILE');
    expect(releaseHygieneSources).toContain('scripts/run-with-env.sh');
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
      'docs/02-hosting-infrastructure.md',
      'docs/03-self-host-deployment.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const releaseIndexSources = ['docs/CLAUDE.md']
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
    expect(releaseIndexSources).toContain('03-self-host-deployment.md');
  });

  it('does not ship the standalone social feed ranking workspace', () => {
    const workspaceSources = [
      'package.json',
      'package-lock.json',
      'apps/web/package.json',
      'apps/web/next.config.js',
      'apps/web/Dockerfile',
      'apps/web/Dockerfile.workers',
      'apps/web/src/lib/CLAUDE.md',
    ]
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');

    expect(existsSync(resolve(repoRoot, 'packages/feed'))).toBe(false);
    expect(workspaceSources).not.toContain('@sottofm/feed');
    expect(workspaceSources).not.toContain('@sottofm');
    expect(workspaceSources).not.toContain('packages/feed');
    expect(workspaceSources).not.toContain('public episode feed');
    expect(workspaceSources).not.toContain('FollowButton');
    expect(workspaceSources).not.toContain('users/[userId]/follow');
    expect(workspaceSources).not.toContain('episodes/[episodeId]/like');
    expect(workspaceSources).not.toContain('episodes/[episodeId]/fork');
    expect(workspaceSources).not.toContain('From Your People');
    expect(workspaceSources).not.toContain('followedCreatorIds');
  });

  it('does not ship episode social action routes or player widgets', () => {
    const removedRoutes = [
      'src/app/api/v1/episodes/[episodeId]/fork/route.ts',
      'src/app/api/v1/episodes/[episodeId]/fork-voice/route.ts',
      'src/app/api/v1/episodes/[episodeId]/like/route.ts',
      'src/app/api/v1/episodes/[episodeId]/comments/route.ts',
      'src/app/api/v1/episodes/[episodeId]/comments/[commentId]/route.ts',
      'src/app/api/v1/episodes/[episodeId]/comments/[commentId]/replies/route.ts',
      'src/app/api/v1/episodes/[episodeId]/interact/[interactionId]/vote/route.ts',
      'src/app/api/v1/episodes/[episodeId]/lineage/route.ts',
      'src/app/api/v1/episodes/[episodeId]/questions/route.ts',
      'src/app/api/v1/episodes/[episodeId]/voice-tracks/[trackId]/propose/route.ts',
      'src/app/api/v1/users/[userId]/liked/route.ts',
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
    const playerSource = readSource('src/app/episode/[episodeId]/EpisodePlayerView.tsx');

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
      ])
      .join('\n');
    const removedTests = [
      'apps/web/tests/api/episodes-questions.test.ts',
      'e2e/playwright/tests/api/episode-social.api.spec.ts',
      'e2e/playwright/tests/api/feed-social.api.spec.ts',
      'e2e/playwright/tests/api/users-public.api.spec.ts',
      'e2e/playwright/tests/fork.spec.ts',
    ];

    for (const testPath of removedTests) {
      expect(existsSync(resolve(repoRoot, testPath)), testPath).toBe(false);
    }
    expect(notificationSources).not.toContain('EPISODE_LIKED');
    expect(notificationSources).not.toContain('EPISODE_FORKED');
    expect(notificationSources).not.toContain('NEW_FOLLOWER');
    expect(notificationSources).not.toContain('SIMILAR_EPISODE_CREATED');
    expect(notificationSources).not.toContain('QUESTION_UPVOTED');
    expect(notificationSources).not.toContain('COMMENT_ON_YOUR_EPISODE');
    expect(notificationSources).not.toContain('COMMENT_REPLY');
  });

  it('keeps automation harnesses private-first', () => {
    const harnessSources = [
      'apps/web/src/app/welcome/WelcomeFlow.tsx',
      'apps/web/src/lib/CLAUDE.md',
      'apps/web/src/lib/auth-guards.ts',
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
      'apps/web/src/app/api/v1/episodes/route.ts',
      'apps/web/src/app/api/v1/tts-options/route.ts',
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
      ...readdirSync(docsDir)
        .filter((name) => name.endsWith('.md'))
        .map((name) => `docs/${name}`),
    ];
    const releaseDocsSource = releaseDocPaths
      .map((file) => readFileSync(resolve(repoRoot, file), 'utf8'))
      .join('\n');
    const staleClaims = [
      'Every voice. Every topic. One feed',
      'Where episodes get social',
      'social episode network',
      'GitHub for episodes',
      'public on a social feed',
      'Public episodes on a social feed',
      'Social Discovery Feed',
      'Fork & remix',
      'fork & remix',
      'fork and remix anyone',
      'Trending to Fork',
      'YouTube of AI episodes',
      'EPISODE_FORKED',
      'NEW_FOLLOWER',
      'Explore Feed',
      'Public Feed',
      '/api/v1/feed',
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
    expect(releaseDocsSource).toContain('keyless local agent');
  });

  it('does not ship creator or per-episode analytics product routes', () => {
    const removedAnalyticsPaths = [
      'apps/web/src/lib/episode-analytics.ts',
      'apps/web/src/lib/creator-metrics.ts',
      'apps/web/src/app/api/v1/episodes/[episodeId]/analytics',
      'apps/web/src/app/api/v1/creator-analytics',
      'apps/web/src/app/(dashboard)/analytics',
      'apps/web/src/types/analytics.ts',
      'packages/shared/src/types/analytics.ts',
    ];
    for (const path of removedAnalyticsPaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const sidebarSource = readSource('src/components/layout/Sidebar.tsx');

    expect(sidebarSource).not.toContain("href: '/analytics'");
    expect(sidebarSource).not.toContain('getCreatorEngagement');
    expect(sidebarSource).not.toContain('getEpisodeEngagement');
    expect(sidebarSource).not.toContain('likeCount');
    expect(sidebarSource).not.toContain('forkCount');
  });

  it('does not ship the episode recommendation engine or feed', () => {
    const removedRecommendationPaths = [
      'apps/web/src/lib/recommendation-engine.ts',
      'apps/web/src/lib/recommendations.ts',
      'apps/web/src/lib/recommendation-metrics.ts',
      'apps/web/src/app/api/v1/recommendations',
      'apps/web/src/app/api/v1/picks',
      'apps/web/src/app/api/v1/users/me/recommendations',
      'apps/web/src/app/api/v1/inspire/all',
      'apps/web/src/app/(admin)/admin/recommendations',
    ];
    for (const path of removedRecommendationPaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    expect(schemaSource).not.toContain('model RecommendationLog');
  });

  it('does not ship voice-track APIs and keeps live episode status owner-gated', () => {
    const removedVoiceTrackPaths = [
      'apps/web/src/app/api/v1/episodes/[episodeId]/voice-tracks',
      'apps/web/src/app/api/v1/episodes/[episodeId]/default-track',
    ];
    for (const path of removedVoiceTrackPaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }

    const liveEpisodeSources = ['src/app/api/v1/episodes/[episodeId]/route.ts']
      .map(readSource)
      .join('\n');

    expect(liveEpisodeSources).toContain("errorResponse('Unauthorized', 401)");
    expect(liveEpisodeSources).toContain('episode.userId !== authResult.userId');
    expect(liveEpisodeSources).not.toContain('No auth required');
    expect(liveEpisodeSources).not.toContain('Auth is optional');
    expect(liveEpisodeSources).not.toContain('public episodes visible to all');
  });

  it('keeps local ingestion surfaces authenticated and private-only', () => {
    const agentIngestRouteSource = readSource('src/app/api/v1/ingest/agent/route.ts');
    const privateIngestionSource = readSource('src/lib/private-ingestion.ts');
    const schemaSource = readFileSync(resolve(repoRoot, 'apps/web/prisma/schema.prisma'), 'utf8');
    const sharedEnumsSource = readFileSync(
      resolve(repoRoot, 'packages/shared/src/types/enums.ts'),
      'utf8'
    );

    expect(agentIngestRouteSource).toContain('authenticateRequest(request)');
    expect(agentIngestRouteSource).toContain("errorResponse('Unauthorized', 401)");
    expect(agentIngestRouteSource).toContain("source: 'AGENT'");
    expect(agentIngestRouteSource).toContain('createPrivateIngestionEpisode');
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
      'src/app/api/v1/source-connectors/readiness/route.ts'
    );
    const onboardingSources = [
      readSource('src/app/welcome/steps/StepContext.tsx'),
      // The "nothing leaves your machine" privacy promise is stated on the landing,
      // which is part of the OSS onboarding/positioning surface this guardrail covers.
      readSource('src/app/page.tsx'),
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
    expect(onboardingSources).toContain('read locally');
    expect(onboardingSources).toContain('privateOnly: true');
    expect(onboardingSources).not.toContain("visibility: 'PUBLIC'");
    expect(onboardingSources).not.toContain('shared content feed');
    expect(onboardingSources).not.toContain('public workspace connector');
  });

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
    const seedSources = [
      'apps/web/prisma/seed.ts',
      'apps/web/prisma/seed-demo.ts',
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
    const adminEpisodeRouteSource = readSource('src/app/api/v1/admin/episodes/[episodeId]/route.ts');

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
    const userValidationSources = ['src/lib/validations.ts']
      .map(readSource)
      .join('\n');
    const activityWriteSources = ['src/app/api/v1/episodes/route.ts']
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
