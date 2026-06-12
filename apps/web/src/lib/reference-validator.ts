/**
 * Reference Validator — 4-layer verification pipeline for episode citations.
 *
 * Layer 1: URL Resolution (HTTP HEAD)
 * Layer 2: DOI via CrossRef API
 * Layer 3: Title Search via OpenAlex API
 * Layer 4: Claude AI Evaluation
 */

import { safeFetch } from './url-validator';

export interface VerificationCheck {
  layer: 'url' | 'doi' | 'title_search' | 'ai' | 'grounding';
  passed: boolean;
  confidence: number;
  detail: string;
  replacement?: ReplacementData;
}

export interface ReplacementData {
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  doi: string | null;
  publisher: string | null;
}

export interface ReferenceInput {
  id: string;
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  doi: string | null;
  type: string;
}

export interface VerificationVerdict {
  status: 'VERIFIED' | 'FAILED' | 'REPLACED' | 'REMOVED';
  confidence: number;
  replacement?: ReplacementData;
}

// ---- Source Quality Pre-Filter ----

const BLOCKED_DOMAINS = [
  'wikipedia.org',
  'medium.com',
  'substack.com',
  'reddit.com',
  'quora.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'blogspot.com',
  'wordpress.com',
  'tumblr.com',
  'buzzfeed.com',
  'ehow.com',
  'wikihow.com',
  'about.com',
];

const TRUSTED_PATTERNS = [
  '.gov',
  '.edu',
  '.ac.',
  'nature.com',
  'science.org',
  'springer.com',
  'wiley.com',
  'nih.gov',
  'arxiv.org',
  'jstor.org',
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'nytimes.com',
  'sciencedirect.com',
  'pubmed.ncbi.nlm.nih.gov',
  'pnas.org',
  'thelancet.com',
  'bmj.com',
  'cell.com',
  'ieee.org',
  'acm.org',
  'tandfonline.com',
  'cambridge.org',
  'oxford.org',
  'oxfordacademic.com',
  // Educational platforms
  'khanacademy.org',
  'openstax.org',
  'coursera.org',
  'edx.org',
  'brilliant.org',
  'ck12.org',
  'nctm.org',
  'corestandards.org',
  'mathworld.wolfram.com',
  'ted.com',
  'duolingo.com',
  'codecademy.com',
  'phet.colorado.edu',
];

export function assessSourceQuality(ref: ReferenceInput): {
  accepted: boolean;
  reason: string;
} {
  if (!ref.url) {
    // No URL — allow through (might have DOI or be a book)
    if (ref.doi || ref.type === 'BOOK') {
      return { accepted: true, reason: 'No URL but has DOI or is a book' };
    }
    return { accepted: true, reason: 'No URL to evaluate' };
  }

  let hostname: string;
  try {
    hostname = new URL(ref.url).hostname.toLowerCase();
  } catch {
    return { accepted: false, reason: 'Invalid URL format' };
  }

  for (const blocked of BLOCKED_DOMAINS) {
    if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
      return { accepted: false, reason: `Blocked source: ${blocked}` };
    }
  }

  for (const trusted of TRUSTED_PATTERNS) {
    if (hostname.includes(trusted)) {
      return { accepted: true, reason: `Trusted source: ${trusted}` };
    }
  }

  // Unknown domain — allow through for further verification
  return { accepted: true, reason: 'Unknown domain, proceeding with verification' };
}

// ---- Layer 1: URL Resolution ----

export async function verifyUrl(ref: ReferenceInput): Promise<VerificationCheck> {
  if (!ref.url) {
    return { layer: 'url', passed: false, confidence: 0, detail: 'No URL provided' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await safeFetch(ref.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Sotto/1.0 (reference-validator)' },
    });

    clearTimeout(timeout);

    if (response.ok || (response.status >= 300 && response.status < 400)) {
      return {
        layer: 'url',
        passed: true,
        confidence: 0.6,
        detail: `URL returned ${response.status}`,
      };
    }

    return {
      layer: 'url',
      passed: false,
      confidence: 0,
      detail: `URL returned ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { layer: 'url', passed: false, confidence: 0, detail: `URL check failed: ${message}` };
  }
}

// ---- Layer 2: DOI via CrossRef ----

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleSimilarity(a: string, b: string): number {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) return 1.0;
  if (normA.length === 0 || normB.length === 0) return 0;

  // Check containment
  if (normA.includes(normB) || normB.includes(normA)) return 0.9;

  // Simple word overlap ratio
  const wordsA = new Set(normA.match(/[a-z0-9]+/g) || []);
  const wordsB = new Set(normB.match(/[a-z0-9]+/g) || []);
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

export async function verifyDoi(ref: ReferenceInput): Promise<VerificationCheck> {
  if (!ref.doi) {
    return { layer: 'doi', passed: false, confidence: 0, detail: 'No DOI provided' };
  }

  try {
    // Clean DOI: strip "https://doi.org/" prefix if present
    const cleanDoi = ref.doi.replace(/^https?:\/\/doi\.org\//, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const contactEmail = process.env.OPENALEX_EMAIL?.trim();
    const userAgent = contactEmail
      ? `Sotto/1.0 (mailto:${contactEmail})`
      : 'Sotto/1.0 (reference-validator)';
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        layer: 'doi',
        passed: false,
        confidence: 0,
        detail: `CrossRef returned ${response.status}`,
      };
    }

    const data = await response.json();
    const work = data.message;

    // Extract title from CrossRef
    const crossRefTitle = Array.isArray(work.title) ? work.title[0] : work.title || '';
    const similarity = titleSimilarity(ref.title, crossRefTitle);

    // Extract authors
    const crossRefAuthors: string[] = (work.author || []).map(
      (a: { given?: string; family?: string }) => [a.given, a.family].filter(Boolean).join(' ')
    );

    if (similarity >= 0.7) {
      return {
        layer: 'doi',
        passed: true,
        confidence: 0.95,
        detail: `DOI verified: title similarity ${(similarity * 100).toFixed(0)}%`,
        replacement: {
          title: crossRefTitle,
          authors: crossRefAuthors,
          year: work.published?.['date-parts']?.[0]?.[0] ?? ref.year,
          url: ref.url,
          doi: cleanDoi,
          publisher: work.publisher || ref.url,
        },
      };
    }

    return {
      layer: 'doi',
      passed: false,
      confidence: 0.1,
      detail: `DOI exists but title mismatch (similarity ${(similarity * 100).toFixed(0)}%)`,
      replacement: {
        title: crossRefTitle,
        authors: crossRefAuthors,
        year: work.published?.['date-parts']?.[0]?.[0] ?? null,
        url: `https://doi.org/${cleanDoi}`,
        doi: cleanDoi,
        publisher: work.publisher || null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      layer: 'doi',
      passed: false,
      confidence: 0,
      detail: `CrossRef check failed: ${message}`,
    };
  }
}

// ---- Layer 3: Title Search via OpenAlex ----

export async function searchTitle(ref: ReferenceInput): Promise<VerificationCheck> {
  if (!ref.title || ref.title.trim().length < 5) {
    return {
      layer: 'title_search',
      passed: false,
      confidence: 0,
      detail: 'Title too short to search',
    };
  }

  try {
    const params = new URLSearchParams({ search: ref.title });

    const email = process.env.OPENALEX_EMAIL;
    if (email) {
      params.set('mailto', email);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`https://api.openalex.org/works?${params.toString()}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Sotto/1.0 (reference-validator)' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        layer: 'title_search',
        passed: false,
        confidence: 0,
        detail: `OpenAlex returned ${response.status}`,
      };
    }

    const data = await response.json();
    const results = data.results || [];

    if (results.length === 0) {
      return {
        layer: 'title_search',
        passed: false,
        confidence: 0,
        detail: 'No results found in OpenAlex',
      };
    }

    // Check top 3 results for a match
    for (const work of results.slice(0, 3)) {
      const workTitle = work.title || '';
      const similarity = titleSimilarity(ref.title, workTitle);

      if (similarity >= 0.7) {
        const authors: string[] = (work.authorships || [])
          .map((a: { author?: { display_name?: string } }) => a.author?.display_name || '')
          .filter(Boolean);

        return {
          layer: 'title_search',
          passed: true,
          confidence: 0.9,
          detail: `Title matched in OpenAlex (similarity ${(similarity * 100).toFixed(0)}%)`,
          replacement: {
            title: workTitle,
            authors,
            year: work.publication_year || null,
            url:
              work.primary_location?.landing_page_url || work.doi
                ? `https://doi.org/${work.doi?.replace('https://doi.org/', '')}`
                : null,
            doi: work.doi?.replace('https://doi.org/', '') || null,
            publisher: work.primary_location?.source?.display_name || null,
          },
        };
      }
    }

    // Partial match: closest result but below threshold
    const bestTitle = results[0].title || '';
    const bestSimilarity = titleSimilarity(ref.title, bestTitle);
    return {
      layer: 'title_search',
      passed: false,
      confidence: bestSimilarity * 0.5,
      detail: `Best match similarity ${(bestSimilarity * 100).toFixed(0)}%, below threshold`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      layer: 'title_search',
      passed: false,
      confidence: 0,
      detail: `OpenAlex check failed: ${message}`,
    };
  }
}

// ---- Layer 4: Claude AI Evaluation ----

// ---- Composite Scoring ----

const LAYER_WEIGHTS = {
  doi: 0.4,
  title_search: 0.3,
  ai: 0.2,
  url: 0.1,
};

export function computeVerificationVerdict(checks: VerificationCheck[]): VerificationVerdict {
  const checkMap = new Map<string, VerificationCheck>();
  for (const check of checks) {
    checkMap.set(check.layer, check);
  }

  const doiCheck = checkMap.get('doi');
  const urlCheck = checkMap.get('url');
  const titleCheck = checkMap.get('title_search');
  const aiCheck = checkMap.get('ai');

  // Override rule 1: DOI verified with title match → always verified
  if (doiCheck?.passed && doiCheck.confidence >= 0.9) {
    return { status: 'VERIFIED', confidence: doiCheck.confidence };
  }

  // Override rule 2: URL 404 + title not found + AI says hallucinated → always failed
  if (
    urlCheck &&
    !urlCheck.passed &&
    titleCheck &&
    !titleCheck.passed &&
    aiCheck &&
    !aiCheck.passed &&
    aiCheck.detail.includes('HALLUCINATED')
  ) {
    // Check if any layer has a replacement
    const replacement = findBestReplacement(checks);
    if (replacement) {
      return { status: 'REPLACED', confidence: 0.1, replacement };
    }
    return { status: 'REMOVED', confidence: 0 };
  }

  // Weighted average scoring
  let weightedSum = 0;
  let totalWeight = 0;

  for (const check of checks) {
    const weight = LAYER_WEIGHTS[check.layer as keyof typeof LAYER_WEIGHTS] || 0.1;
    weightedSum += check.confidence * weight;
    totalWeight += weight;
  }

  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  if (compositeScore >= 0.65) {
    return { status: 'VERIFIED', confidence: compositeScore };
  }

  // Below threshold: try to find a replacement
  const replacement = findBestReplacement(checks);
  if (replacement) {
    return { status: 'REPLACED', confidence: compositeScore, replacement };
  }

  return { status: 'REMOVED', confidence: compositeScore };
}

function findBestReplacement(checks: VerificationCheck[]): ReplacementData | undefined {
  // Prefer DOI replacement, then title search, then AI
  const priority: Array<'doi' | 'title_search' | 'ai'> = ['doi', 'title_search', 'ai'];

  for (const layer of priority) {
    const check = checks.find((c) => c.layer === layer && c.replacement);
    if (check?.replacement) {
      return check.replacement;
    }
  }

  return undefined;
}
