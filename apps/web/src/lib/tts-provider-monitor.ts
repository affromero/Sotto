/**
 * TTS Provider Monitor — detects new models, voices, and features across providers.
 *
 * Runs daily as a BullMQ scheduled worker. Queries each provider's API,
 * diffs against a Redis snapshot, uses Claude to analyze changes, and
 * creates GitHub issues with actionable recommendations.
 *
 * Monitored providers are derived from tts-registry.ts (only those with
 * API-accessible model/voice lists: elevenlabs, cartesia, hume, openai).
 */

import { cache } from './redis';
import { logger } from './logger';
import { createAIProvider } from './providers/ai';
import { isValidAiProviderId, type AiProviderId } from './providers/ai-registry';
import { getVoiceCatalog } from './voice-catalog';
import { getProviderMeta, type TtsProviderId } from './providers/tts-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderSnapshot {
  provider: string;
  models: Array<{ id: string; name: string }>;
  voiceCount: number;
  voiceIds: string[];
  fetchedAt: string;
}

interface MonitorSnapshot {
  version: number;
  providers: Record<string, ProviderSnapshot>;
  lastRunAt: string;
}

interface SnapshotDiff {
  provider: string;
  newModels: Array<{ id: string; name: string }>;
  removedModels: Array<{ id: string; name: string }>;
  newVoiceCount: number;
  removedVoiceCount: number;
  newVoiceIds: string[];
}

// ---------------------------------------------------------------------------
// Provider list — derived from registry, filtered to API-accessible providers
// ---------------------------------------------------------------------------

/** Providers with API-accessible model/voice lists. Others (fal, replicate, minimax) use fixed sets. */
const MONITORED_PROVIDERS: TtsProviderId[] = ['elevenlabs', 'cartesia', 'hume', 'openai'];

// ---------------------------------------------------------------------------
// Model fetchers — separate from voice catalog (which only tracks voices)
// ---------------------------------------------------------------------------

async function fetchElevenLabsModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch('https://api.elevenlabs.io/v1/models', {
    headers: { 'xi-api-key': apiKey },
  });
  if (!response.ok) throw new Error(`ElevenLabs models API error (${response.status})`);
  const data = await response.json();
  return (data as Array<{ model_id: string; name: string }>).map((m) => ({
    id: m.model_id,
    name: m.name,
  }));
}

async function fetchOpenAIModels(apiKey: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI models API error (${response.status})`);
  const data = await response.json();
  return (data.data as Array<{ id: string }>)
    .filter((m) => m.id.includes('tts'))
    .map((m) => ({ id: m.id, name: m.id }));
}

function getKnownModels(providerId: TtsProviderId): Array<{ id: string; name: string }> {
  const meta = getProviderMeta(providerId);
  return meta.models.map((m) => ({ id: m.id, name: m.displayName }));
}

// ---------------------------------------------------------------------------
// Snapshot fetching
// ---------------------------------------------------------------------------

async function fetchProviderState(providerId: TtsProviderId): Promise<ProviderSnapshot> {
  const apiKey = getApiKeyForProvider(providerId);

  // Fetch models
  let models: Array<{ id: string; name: string }>;
  if (providerId === 'elevenlabs' && apiKey) {
    models = await fetchElevenLabsModels(apiKey);
  } else if (providerId === 'openai' && apiKey) {
    models = await fetchOpenAIModels(apiKey);
  } else {
    // Cartesia and Hume don't have public model list APIs — use registry
    models = getKnownModels(providerId);
  }

  // Fetch voices via existing catalog (handles API calls + caching)
  const voices = await getVoiceCatalog(providerId, apiKey ?? undefined);
  const voiceIds = voices.map((v) => v.id).sort();

  return {
    provider: providerId,
    models,
    voiceCount: voices.length,
    voiceIds,
    fetchedAt: new Date().toISOString(),
  };
}

function getApiKeyForProvider(providerId: TtsProviderId): string | null {
  switch (providerId) {
    case 'elevenlabs':
      return process.env.ELEVENLABS_API_KEY ?? null;
    case 'cartesia':
      return process.env.CARTESIA_API_KEY ?? null;
    case 'hume':
      return process.env.HUME_API_KEY ?? null;
    case 'openai':
      return process.env.OPENAI_API_KEY ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshot diffing
// ---------------------------------------------------------------------------

export function diffSnapshots(previous: MonitorSnapshot, current: MonitorSnapshot): SnapshotDiff[] {
  const diffs: SnapshotDiff[] = [];

  for (const providerId of MONITORED_PROVIDERS) {
    const prev = previous.providers[providerId];
    const curr = current.providers[providerId];
    if (!curr) continue;
    if (!prev) {
      // New provider — report everything as new
      diffs.push({
        provider: providerId,
        newModels: curr.models,
        removedModels: [],
        newVoiceCount: curr.voiceCount,
        removedVoiceCount: 0,
        newVoiceIds: curr.voiceIds,
      });
      continue;
    }

    const prevModelIds = new Set(prev.models.map((m) => m.id));
    const currModelIds = new Set(curr.models.map((m) => m.id));
    const newModels = curr.models.filter((m) => !prevModelIds.has(m.id));
    const removedModels = prev.models.filter((m) => !currModelIds.has(m.id));

    const prevVoiceIds = new Set(prev.voiceIds);
    const currVoiceIds = new Set(curr.voiceIds);
    const newVoiceIds = curr.voiceIds.filter((id) => !prevVoiceIds.has(id));
    const removedVoiceIds = prev.voiceIds.filter((id) => !currVoiceIds.has(id));

    if (
      newModels.length > 0 ||
      removedModels.length > 0 ||
      newVoiceIds.length > 0 ||
      removedVoiceIds.length > 0
    ) {
      diffs.push({
        provider: providerId,
        newModels,
        removedModels,
        newVoiceCount: newVoiceIds.length,
        removedVoiceCount: removedVoiceIds.length,
        newVoiceIds,
      });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Claude analysis
// ---------------------------------------------------------------------------

function getMonitorAiRuntime(): { provider: AiProviderId; model: string } {
  const provider = process.env.TTS_MONITOR_AI_PROVIDER;
  const model = process.env.TTS_MONITOR_AI_MODEL;

  if (!provider || !model) {
    throw new Error(
      'TTS provider monitor requires TTS_MONITOR_AI_PROVIDER and TTS_MONITOR_AI_MODEL.'
    );
  }
  if (!isValidAiProviderId(provider)) {
    throw new Error(`Unknown TTS monitor AI provider: "${provider}".`);
  }

  return { provider, model };
}

async function analyzeChangesWithLlm(diffs: SnapshotDiff[]): Promise<string> {
  const diffSummary = diffs
    .map((d) => {
      const parts: string[] = [`### ${d.provider}`];
      if (d.newModels.length > 0)
        parts.push(`New models: ${d.newModels.map((m) => m.id).join(', ')}`);
      if (d.removedModels.length > 0)
        parts.push(`Removed models: ${d.removedModels.map((m) => m.id).join(', ')}`);
      if (d.newVoiceCount > 0) parts.push(`${d.newVoiceCount} new voices`);
      if (d.removedVoiceCount > 0) parts.push(`${d.removedVoiceCount} removed voices`);
      return parts.join('\n');
    })
    .join('\n\n');

  const registryInfo = MONITORED_PROVIDERS.map((id) => {
    const meta = getProviderMeta(id);
    return `${meta.displayName}: default=${meta.defaultModel}, models=[${meta.models.map((m) => m.id).join(', ')}]`;
  }).join('\n');

  const systemPrompt = `You are a TTS integration engineer for Sotto, a language-learning audio platform.
Analyze TTS provider API changes and assess their relevance to conversational audio lesson generation.
Be concise and actionable. Output markdown suitable for a GitHub issue body.

Current Sotto TTS config:
${registryInfo}

Structure your response as:
## Changes Detected
[bullet list]

## Relevance to Sotto
[1-2 sentences]

## Recommended Actions
[checkbox list with specific file paths: tts-registry.ts, tts-voices.ts, voice-pool.ts, tts-expression-mapper.ts]

## Priority
[High/Medium/Low] — [one sentence reasoning]`;

  const runtime = getMonitorAiRuntime();
  const ai = createAIProvider(runtime.provider);
  const response = await ai.generateResponse(
    systemPrompt,
    [{ role: 'user', content: `TTS provider changes detected:\n\n${diffSummary}` }],
    { maxTokens: 1500, model: runtime.model, skipModeration: true }
  );

  return response.content;
}

// ---------------------------------------------------------------------------
// GitHub issue management
// ---------------------------------------------------------------------------

async function findExistingIssue(title: string): Promise<boolean> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return false;

  try {
    const response = await fetch(
      'https://api.github.com/repos/affromero/Sotto/issues?state=open&labels=tts-monitor&per_page=100',
      { headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' } }
    );
    if (!response.ok) return false;
    const issues = (await response.json()) as Array<{ title: string }>;
    return issues.some((issue) => issue.title === title);
  } catch {
    return false;
  }
}

async function createGitHubIssue(title: string, body: string): Promise<string | null> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    logger.warn('GITHUB_PAT not set — skipping issue creation');
    return null;
  }

  try {
    const response = await fetch('https://api.github.com/repos/affromero/Sotto/issues', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels: ['tts-monitor', 'enhancement'] }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('GitHub issue creation failed', { status: response.status, error: errorText });
      return null;
    }

    const issue = (await response.json()) as { html_url: string };
    return issue.html_url;
  } catch (err) {
    logger.error('GitHub issue creation error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Redis snapshot management
// ---------------------------------------------------------------------------

const SNAPSHOT_KEY = 'tts-monitor:snapshot';

async function getSnapshot(): Promise<MonitorSnapshot | null> {
  return cache.get<MonitorSnapshot>(SNAPSHOT_KEY);
}

async function saveSnapshot(snapshot: MonitorSnapshot): Promise<void> {
  await cache.set(SNAPSHOT_KEY, snapshot);
}

// ---------------------------------------------------------------------------
// Main monitor function (called by the worker)
// ---------------------------------------------------------------------------

export async function runTtsProviderMonitor(): Promise<void> {
  logger.info('TTS provider monitor starting', { providers: MONITORED_PROVIDERS });

  // Fetch current state from all providers (parallel, fault-tolerant)
  const results = await Promise.allSettled(
    MONITORED_PROVIDERS.map(async (id) => {
      const state = await fetchProviderState(id);
      return { id, state };
    })
  );

  const currentProviders: Record<string, ProviderSnapshot> = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      currentProviders[result.value.id] = result.value.state;
    } else {
      logger.warn('Provider fetch failed', {
        error: result.reason?.message ?? String(result.reason),
      });
    }
  }

  if (Object.keys(currentProviders).length === 0) {
    logger.warn('All provider fetches failed — skipping monitor run');
    return;
  }

  const current: MonitorSnapshot = {
    version: 1,
    providers: currentProviders,
    lastRunAt: new Date().toISOString(),
  };

  // Load previous snapshot
  const previous = await getSnapshot();

  if (!previous) {
    // First run — seed baseline, no issues
    logger.info('TTS monitor: initial seed — saving baseline snapshot');
    await saveSnapshot(current);
    return;
  }

  // Diff
  const diffs = diffSnapshots(previous, current);

  if (diffs.length === 0) {
    logger.info('TTS monitor: no changes detected');
    await saveSnapshot(current);
    return;
  }

  logger.info('TTS monitor: changes detected', {
    providers: diffs.map((d) => d.provider).join(', '),
    totalNewModels: String(diffs.reduce((sum, d) => sum + d.newModels.length, 0)),
    totalNewVoices: String(diffs.reduce((sum, d) => sum + d.newVoiceCount, 0)),
  });

  // Analyze with Claude
  const analysis = await analyzeChangesWithLlm(diffs);

  // Create one issue per provider with changes
  for (const diff of diffs) {
    const meta = getProviderMeta(diff.provider as TtsProviderId);
    const title = `[TTS Monitor] ${meta.displayName}: ${summarizeDiff(diff)}`;

    const exists = await findExistingIssue(title);
    if (exists) {
      logger.info('TTS monitor: issue already exists, skipping', { title });
      continue;
    }

    const body = buildIssueBody(diff, analysis);
    const url = await createGitHubIssue(title, body);
    if (url) {
      logger.info('TTS monitor: issue created', { url });
    }
  }

  // Save updated snapshot
  await saveSnapshot(current);
  logger.info('TTS provider monitor complete');
}

function summarizeDiff(diff: SnapshotDiff): string {
  const parts: string[] = [];
  if (diff.newModels.length > 0) parts.push(`${diff.newModels.length} new model(s)`);
  if (diff.removedModels.length > 0) parts.push(`${diff.removedModels.length} removed model(s)`);
  if (diff.newVoiceCount > 0) parts.push(`${diff.newVoiceCount} new voice(s)`);
  if (diff.removedVoiceCount > 0) parts.push(`${diff.removedVoiceCount} removed voice(s)`);
  return parts.join(', ') || 'capability changes';
}

function buildIssueBody(diff: SnapshotDiff, analysis: string): string {
  const rawDiff = JSON.stringify(diff, null, 2);
  return `${analysis}

---

<details>
<summary>Raw API diff</summary>

\`\`\`json
${rawDiff}
\`\`\`

</details>

_Created automatically by the TTS Provider Monitor._`;
}
