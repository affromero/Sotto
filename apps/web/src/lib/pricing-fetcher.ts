/**
 * Pricing fetcher — fetches AI model pricing from provider docs pages,
 * extracts pricing via LLM, and persists snapshots to the database.
 */
import { prisma } from './prisma';
import { logger } from './logger';
import { isValidModelId, getAllAiProviderMeta } from './providers/ai-registry';

// ---------------------------------------------------------------------------
// Provider pricing page URLs
// ---------------------------------------------------------------------------

export const PRICING_URLS: Record<string, string> = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/docs/about-claude/models',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedModelPricing {
  modelId: string;
  displayName: string;
  inputPerMTok: number;
  outputPerMTok: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

// ---------------------------------------------------------------------------
// Fetch + extract
// ---------------------------------------------------------------------------

/** Fetch a provider's pricing page and strip to plain text (8K char limit). */
export async function fetchProviderPricingPage(provider: string): Promise<string> {
  const url = PRICING_URLS[provider];
  if (!url) throw new Error(`No pricing URL for provider: ${provider}`);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'SottoFM-PricingBot/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch pricing page for ${provider}: ${res.status}`);

  const html = await res.text();
  // Strip HTML tags, collapse whitespace, limit to 8K chars
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8_000);
  return text;
}

/** Use LLM to extract structured pricing from page text. */
export async function extractPricingFromPage(
  provider: string,
  pageText: string
): Promise<ExtractedModelPricing[]> {
  const { createAIProvider } = await import('./providers/ai');
  const { resolveAutoModel } = await import('./auto-model-config');

  const autoConfig = await resolveAutoModel('PLATFORM');
  const ai = createAIProvider(autoConfig.aiProvider);

  const system = `You are a pricing data extractor. Extract AI model pricing from the given text.
Return a JSON array of objects with these fields:
- modelId: the API model identifier (e.g. "gpt-5-mini", "claude-sonnet-4-6", "gemini-3.1-flash-lite-preview")
- displayName: human-readable name
- inputPerMTok: price per million input tokens in USD (number)
- outputPerMTok: price per million output tokens in USD (number)
- contextWindow: max input context in tokens (number, optional)
- maxOutputTokens: max output tokens (number, optional)

Only include chat/text generation models. Skip embedding, image, audio, and fine-tuning models.
Return ONLY the JSON array, no markdown or explanation.`;

  const response = await ai.generateResponse(system, [
    { role: 'user', content: `Extract ${provider} model pricing from this page:\n\n${pageText}` },
  ], {
    skipModeration: true,
    maxTokens: 2048,
    model: autoConfig.aiModel,
  });

  try {
    const parsed = JSON.parse(response.content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: Record<string, unknown>) =>
        typeof m.modelId === 'string' &&
        typeof m.inputPerMTok === 'number' &&
        typeof m.outputPerMTok === 'number'
    );
  } catch {
    logger.warn('Failed to parse LLM pricing extraction', { provider, content: response.content.slice(0, 200) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/** Save pricing snapshots to the database. */
export async function savePricingSnapshots(
  snapshots: Array<{
    modelId: string;
    provider: string;
    inputPerMTok: number;
    outputPerMTok: number;
    contextWindow?: number;
    maxOutputTokens?: number;
    source: string;
  }>
): Promise<void> {
  if (snapshots.length === 0) return;
  await prisma.modelPricingSnapshot.createMany({ data: snapshots });
}

/** Get the latest pricing snapshot per model. */
export async function getLatestPricingFromDb(): Promise<
  Map<string, { inputPerMTok: number; outputPerMTok: number; source: string }>
> {
  const snapshots = await prisma.$queryRaw<
    Array<{ modelId: string; inputPerMTok: number; outputPerMTok: number; source: string }>
  >`
    SELECT DISTINCT ON ("modelId") "modelId", "inputPerMTok", "outputPerMTok", "source"
    FROM "ModelPricingSnapshot"
    ORDER BY "modelId", "createdAt" DESC
  `;

  const map = new Map<string, { inputPerMTok: number; outputPerMTok: number; source: string }>();
  for (const s of snapshots) {
    map.set(s.modelId, { inputPerMTok: s.inputPerMTok, outputPerMTok: s.outputPerMTok, source: s.source });
  }
  return map;
}

/** Get model IDs where the latest snapshot has source='admin'. */
export async function getAdminOverriddenModels(): Promise<Set<string>> {
  const map = await getLatestPricingFromDb();
  const adminSet = new Set<string>();
  for (const [modelId, data] of map) {
    if (data.source === 'admin') adminSet.add(modelId);
  }
  return adminSet;
}

/** Seed the pricing table from the registry if no snapshots exist. */
export async function seedPricingFromRegistry(): Promise<void> {
  const count = await prisma.modelPricingSnapshot.count();
  if (count > 0) return;

  const snapshots: Array<{
    modelId: string;
    provider: string;
    inputPerMTok: number;
    outputPerMTok: number;
    contextWindow: number;
    maxOutputTokens: number;
    source: string;
  }> = [];

  for (const provider of getAllAiProviderMeta()) {
    for (const model of provider.models) {
      if (!model.pricing) continue;
      snapshots.push({
        modelId: model.id,
        provider: provider.id,
        inputPerMTok: model.pricing.inputPerMTok,
        outputPerMTok: model.pricing.outputPerMTok,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        source: 'registry',
      });
    }
  }

  if (snapshots.length > 0) {
    await prisma.modelPricingSnapshot.createMany({ data: snapshots });
    logger.info('Seeded pricing table from registry', { count: snapshots.length });
  }
}

/** Filter extracted pricing to only models we know about. */
export function filterToKnownModels(
  extracted: ExtractedModelPricing[]
): ExtractedModelPricing[] {
  return extracted.filter((m) => isValidModelId(m.modelId));
}
