/**
 * Research Agent — builds a verified knowledge dossier for podcast generation.
 *
 * Three modes:
 *  - source-bound: extract facts from user-supplied URLs (no web research)
 *  - curated: seed dossier from briefing articles (no web research)
 *  - open-web: full web research to discover sources, extract facts, find angles
 */

import { createAIProvider } from './providers/ai';
import { loadAndRender } from './prompt-loader';
import {
  assessSourceQuality,
  verifyUrl,
  verifyDoi,
  searchTitle,
  type ReferenceInput,
} from './reference-validator';
import { getMinReferenceCount } from './reference-thresholds';
import { logger } from './logger';

// ---- Types ----

export interface SourceRecord {
  sourceId: string;
  canonicalUrl: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedAt: string | null;
  year: number | null;
  type: 'PAPER' | 'REPORT' | 'ARTICLE' | 'BOOK' | 'VIDEO' | 'WEB';
  domain: 'ACADEMIC' | 'NEWS' | 'GOVERNMENT' | 'EDUCATIONAL' | 'GENERAL';
  verification: {
    status: 'verified' | 'weak' | 'rejected';
    score: number;
    checks: { url: boolean; doi: boolean; title: boolean };
  };
  excerpts: Array<{ excerptId: string; locator: string; text: string }>;
}

export interface EvidenceCard {
  evidenceId: string;
  claim: string;
  claimType: 'fact' | 'stat' | 'quote' | 'bio' | 'timeline' | 'definition';
  sourceIds: string[];
  excerptIds: string[];
  confidence: number;
  caveats: string[];
  freshness: 'current' | 'evergreen' | 'historical';
}

export interface ResearchAngle {
  theme: string;
  description: string;
  supportingEvidence: string[];
  narrativePotential: 'high' | 'medium' | 'low';
}

export interface UserBrief {
  topic: string;
  audienceLevel: string;
  tone: string;
  durationTarget: number;
  mustCover: string[];
  mustAvoid: string[];
  priorKnowledge?: string;
  suppliedSourceUrls: string[];
  discoverySummary: string;
}

export interface DossierResult {
  mode: 'source-bound' | 'curated' | 'open-web';
  userBrief: UserBrief;
  sources: SourceRecord[];
  evidence: EvidenceCard[];
  gaps: string[];
  blockedClaims: string[];
  recommendedAngle: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  model: string;
}

export interface BuildDossierParams {
  mode: 'source-bound' | 'curated' | 'open-web';
  topic: string;
  depth: string;
  tone: string;
  audienceLevel: string;
  durationTarget: number;
  sourceContent?: string;
  focusAreas?: string[];
  mustCover?: string[];
  mustAvoid?: string[];
  suppliedSourceUrls?: string[];
  discoverySummary?: string;
  curatedArticles?: string; // pre-formatted briefing articles
  apiKeyOverride?: string;
  model?: string;
  provider: string;
}

// ---- Helpers ----

const DEPTH_DESCRIPTIONS: Record<string, string> = {
  deep_dive: 'Comprehensive treatment. Academic-level rigor, extensive citations, nuance.',
  standard: 'Solid coverage. Clear explanations, good citations, balanced depth.',
  quick_overview: 'Brief treatment. Key points, essential context, select citations.',
  eli5: 'Simple explanation. Core concepts only, minimal citations, accessible language.',
};

function extractFirstJson(text: string): string {
  const trimmed = text.trim();
  try { JSON.parse(trimmed); return trimmed; } catch { /* continue */ }
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Unbalanced JSON in response');
}

function classifyDomain(type: string, url: string | null): SourceRecord['domain'] {
  if (type === 'PAPER' || type === 'BOOK') return 'ACADEMIC';
  if (type === 'REPORT') return 'GOVERNMENT';
  if (!url) return 'GENERAL';
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith('.gov') || host.endsWith('.gov.uk')) return 'GOVERNMENT';
  if (host.endsWith('.edu') || host.includes('.ac.')) return 'EDUCATIONAL';
  if (['reuters.com', 'apnews.com', 'bbc.com', 'nytimes.com', 'theguardian.com', 'nature.com', 'science.org'].some(d => host.includes(d))) return 'NEWS';
  return 'GENERAL';
}

// ---- Source Verification ----

async function verifySources(sources: SourceRecord[]): Promise<SourceRecord[]> {
  const results: SourceRecord[] = [];

  for (const source of sources) {
    const refInput: ReferenceInput = {
      id: source.sourceId,
      number: 0,
      title: source.title,
      authors: source.authors,
      year: source.year,
      url: source.canonicalUrl,
      doi: null, // DOI extracted from URL if present
      type: source.type,
    };

    // Pre-filter blocked domains
    const quality = assessSourceQuality(refInput);
    if (!quality.accepted) {
      logger.info('Source rejected by quality filter', { sourceId: source.sourceId, reason: quality.reason });
      source.verification = { status: 'rejected', score: 0, checks: { url: false, doi: false, title: false } };
      continue;
    }

    // Run verification layers
    const [urlCheck, doiCheck, titleCheck] = await Promise.all([
      verifyUrl(refInput),
      verifyDoi(refInput),
      searchTitle(refInput),
    ]);

    const urlPassed = urlCheck.passed;
    const doiPassed = doiCheck.passed;
    const titlePassed = titleCheck.passed;

    const score = Math.max(
      urlPassed ? urlCheck.confidence : 0,
      doiPassed ? doiCheck.confidence : 0,
      titlePassed ? titleCheck.confidence : 0,
    );

    const status: SourceRecord['verification']['status'] =
      doiPassed || (urlPassed && titlePassed) ? 'verified' :
      urlPassed || titlePassed ? 'weak' :
      'rejected';

    source.verification = { status, score, checks: { url: urlPassed, doi: doiPassed, title: titlePassed } };

    if (status !== 'rejected') {
      results.push(source);
    } else {
      logger.info('Source rejected after verification', { sourceId: source.sourceId, title: source.title });
    }
  }

  return results;
}

// ---- Main Entry Point ----

export async function buildResearchDossier(params: BuildDossierParams): Promise<DossierResult> {
  const ai = createAIProvider(params.provider);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let modelUsed = params.model || 'unknown';

  const userBrief: UserBrief = {
    topic: params.topic,
    audienceLevel: params.audienceLevel || 'general',
    tone: params.tone || 'standard',
    durationTarget: params.durationTarget || 10,
    mustCover: params.mustCover || [],
    mustAvoid: params.mustAvoid || [],
    suppliedSourceUrls: params.suppliedSourceUrls || [],
    discoverySummary: params.discoverySummary || '',
  };

  const targetSourceCount = getMinReferenceCount(params.depth, params.durationTarget) + 5; // pad for rejections
  const minSeriousCount = Math.max(2, Math.floor(targetSourceCount * 0.4));

  // ---- Step 1: Source Discovery ----
  logger.info('Research agent: discovering sources', { topic: params.topic, mode: params.mode });

  const sourcePrompt = loadAndRender('research/source-discovery.md', {
    TOPIC: params.topic,
    DEPTH: params.depth,
    DEPTH_DESCRIPTION: DEPTH_DESCRIPTIONS[params.depth] || DEPTH_DESCRIPTIONS.standard,
    SOURCE_COUNT: String(targetSourceCount),
    MIN_SERIOUS_COUNT: String(minSeriousCount),
    SOURCE_CONTENT: params.sourceContent || '(No source material provided — research from scratch)',
  });

  const sourceResponse = await ai.generateResponse(sourcePrompt, [
    { role: 'user', content: `Find ${targetSourceCount} real sources about: ${params.topic}` },
  ], {
    maxTokens: 8192,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
    useWebSearch: params.mode === 'open-web',
  });

  totalInputTokens += sourceResponse.inputTokens;
  totalOutputTokens += sourceResponse.outputTokens;
  modelUsed = sourceResponse.model;

  const sourceData = JSON.parse(extractFirstJson(sourceResponse.content));
  let sources: SourceRecord[] = (sourceData.sources || []).map((s: Record<string, unknown>, i: number) => ({
    sourceId: (s.sourceId as string) || `src_${i + 1}`,
    canonicalUrl: (s.url as string) || null,
    title: (s.title as string) || '',
    authors: (s.authors as string[]) || [],
    publisher: (s.publisher as string) || null,
    publishedAt: null,
    year: (s.year as number) || null,
    type: (s.type as string) || 'WEB',
    domain: classifyDomain((s.type as string) || 'WEB', (s.url as string) || null),
    verification: { status: 'weak' as const, score: 0, checks: { url: false, doi: false, title: false } },
    excerpts: (s.excerpts as Array<{ excerptId: string; locator: string; text: string }>) || [],
  }));

  // ---- Step 2: Verify Sources ----
  logger.info('Research agent: verifying sources', { count: sources.length });
  sources = await verifySources(sources);
  logger.info('Research agent: sources after verification', { verified: sources.length });

  // ---- Step 3: Fact Extraction ----
  logger.info('Research agent: extracting facts');

  const factPrompt = loadAndRender('research/fact-extraction.md', {
    TOPIC: params.topic,
    SOURCES_JSON: JSON.stringify(sources.map(s => ({
      sourceId: s.sourceId, title: s.title, authors: s.authors, year: s.year,
      type: s.type, excerpts: s.excerpts,
    })), null, 2),
  });

  const factResponse = await ai.generateResponse(factPrompt, [
    { role: 'user', content: `Extract all verifiable facts from these ${sources.length} sources about: ${params.topic}` },
  ], {
    maxTokens: 8192,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
  });

  totalInputTokens += factResponse.inputTokens;
  totalOutputTokens += factResponse.outputTokens;

  const factData = JSON.parse(extractFirstJson(factResponse.content));
  const evidence: EvidenceCard[] = (factData.evidence || []).map((e: Record<string, unknown>, i: number) => ({
    evidenceId: (e.evidenceId as string) || `ev_${i + 1}`,
    claim: (e.claim as string) || '',
    claimType: (e.claimType as string) || 'fact',
    sourceIds: (e.sourceIds as string[]) || [],
    excerptIds: (e.excerptIds as string[]) || [],
    confidence: (e.confidence as number) || 0.5,
    caveats: (e.caveats as string[]) || [],
    freshness: (e.freshness as string) || 'evergreen',
  }));

  // ---- Step 4: Angle Discovery ----
  logger.info('Research agent: discovering angles');

  const anglePrompt = loadAndRender('research/angle-discovery.md', {
    TOPIC: params.topic,
    EVIDENCE_JSON: JSON.stringify(evidence.map(e => ({
      evidenceId: e.evidenceId, claim: e.claim, claimType: e.claimType, confidence: e.confidence,
    })), null, 2),
    TOPIC_SUMMARY: sourceData.topicSummary || '',
  });

  const angleResponse = await ai.generateResponse(anglePrompt, [
    { role: 'user', content: `Find the best angles for a ${params.tone} lesson about: ${params.topic}` },
  ], {
    maxTokens: 4096,
    apiKeyOverride: params.apiKeyOverride,
    model: params.model,
  });

  totalInputTokens += angleResponse.inputTokens;
  totalOutputTokens += angleResponse.outputTokens;

  const angleData = JSON.parse(extractFirstJson(angleResponse.content));

  return {
    mode: params.mode,
    userBrief,
    sources,
    evidence,
    gaps: factData.gaps || [],
    blockedClaims: factData.blockedClaims || [],
    recommendedAngle: angleData.recommendedAngle || sourceData.recommendedAngle || null,
    totalInputTokens,
    totalOutputTokens,
    model: modelUsed,
  };
}
