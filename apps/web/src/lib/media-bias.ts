/**
 * Media bias detection using MBFC (Media Bias/Fact Check) dataset.
 * Lazy-loads the static dataset on first call (server-side only).
 *
 * Data source: bundled drmikecrowe/mbfcext snapshot (MIT license; see
 * THIRD_PARTY_NOTICES.md)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { matchTopicTags, TAG_PARENT_MAP } from './topic-tagger';

// ── Types ───────────────────────────────────────────────────────

interface MbfcSource {
  domain: string;
  name: string;
  bias: string;
  reporting?: string;
  credibility?: string;
  questionable?: string[];
}

interface MbfcData {
  sources: Record<string, MbfcSource>;
  aliases: Record<string, string>;
}

export interface BiasEntry {
  domain: string;
  name: string;
  bias: string;
  reporting: string | null;
  credibility: string | null;
  questionable: string[];
}

export interface BiasAnalysis {
  isPolitical: boolean;
  sourceBias: string | null;
  sourceFactuality: string | null;
  sourceName: string | null;
}

// ── Political tag set ───────────────────────────────────────────

const POLITICAL_TAGS = new Set([
  'politics-society',
  'geopolitics',
  'human-rights',
  'immigration',
  'public-policy',
  'social-movements',
  'political-philosophy',
]);

// ── Lazy-loaded lookup maps ─────────────────────────────────────

let domainMap: Map<string, BiasEntry> | null = null;
let aliasMap: Map<string, string> | null = null;

function ensureLoaded(): void {
  if (domainMap) return;

  const filePath = join(process.cwd(), 'src/data/mbfc-combined.json');
  const raw: MbfcData = JSON.parse(readFileSync(filePath, 'utf-8'));

  domainMap = new Map();
  for (const source of Object.values(raw.sources)) {
    const normalized = normalizeDomain(source.domain);
    domainMap.set(normalized, {
      domain: normalized,
      name: source.name,
      bias: source.bias,
      reporting: source.reporting ?? null,
      credibility: source.credibility ?? null,
      questionable: source.questionable ?? [],
    });
  }

  aliasMap = new Map();
  for (const [alias, canonical] of Object.entries(raw.aliases)) {
    aliasMap.set(normalizeDomain(alias), normalizeDomain(canonical));
  }
}

// ── Public API ──────────────────────────────────────────────────

export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

export function extractDomain(url: string): string {
  return normalizeDomain(new URL(url).hostname);
}

export function lookupMediaBias(domain: string): BiasEntry | null {
  ensureLoaded();
  const normalized = normalizeDomain(domain);
  const entry = domainMap!.get(normalized);
  if (entry) return entry;

  const canonical = aliasMap!.get(normalized);
  if (canonical) return domainMap!.get(canonical) ?? null;

  return null;
}

export function analyzeBias(params: {
  sourceUrl: string;
  topic: string;
  focusAreas?: string[];
}): BiasAnalysis {
  const { sourceUrl, topic, focusAreas = [] } = params;

  // Detect political topic via tag matching
  const matchedTags = matchTopicTags({ topic, focusAreas });
  const isPolitical = matchedTags.some((tag) => {
    if (POLITICAL_TAGS.has(tag)) return true;
    const parent = TAG_PARENT_MAP[tag];
    return parent ? POLITICAL_TAGS.has(parent) : false;
  });

  // Look up source bias
  let entry: BiasEntry | null = null;
  try {
    const domain = extractDomain(sourceUrl);
    entry = lookupMediaBias(domain);
  } catch {
    // Invalid URL — no bias data
  }

  return {
    isPolitical,
    sourceBias: entry?.bias ?? null,
    sourceFactuality: entry?.reporting ?? null,
    sourceName: entry?.name ?? null,
  };
}

/** Reset loaded data (for testing) */
export function _resetForTesting(): void {
  domainMap = null;
  aliasMap = null;
}
