/**
 * Script Compiler — deterministic QC pass that resolves evidence placeholders
 * to numbered footnotes and validates the script against the dossier.
 *
 * No LLM calls. This is a pure compiler/linter.
 *
 * Flow:
 *  1. Parse [[ev_*]] placeholders from script turns
 *  2. Map each evidence ID → source IDs → numbered reference
 *  3. Replace [[ev_*]] with [N] in the text
 *  4. Validate: no unmapped evidence, no raw URLs, word count in bounds
 *  5. Build final Reference[] from dossier sources
 */

import { wordCountBounds } from './duration';
import { getMinReferenceCount } from './reference-thresholds';
import { logger } from './logger';
import type { SourceRecord, EvidenceCard } from './research-agent';

// ---- Types ----

export interface CompileInput {
  turns: Array<{ speaker: string; text: string; direction?: string }>;
  sources: SourceRecord[];
  evidence: EvidenceCard[];
  depth: string;
  durationTarget: number;
}

export interface CompiledReference {
  number: number;
  sourceId: string;
  title: string;
  authors: string;
  year: number | null;
  url: string | null;
  doi: string | null;
  type: string;
  publisher: string | null;
}

export interface CompileResult {
  success: boolean;
  turns: Array<{ speaker: string; text: string; direction?: string }>;
  references: CompiledReference[];
  errors: string[];
  warnings: string[];
  evidenceToSourceMap: Record<string, string[]>;
  stats: {
    totalEvidenceCited: number;
    totalSourcesUsed: number;
    totalReferences: number;
    wordCount: number;
  };
}

// ---- Helpers ----

const EVIDENCE_PLACEHOLDER_RE = /\[\[ev_(\w+)\]\]/g;
const RAW_URL_RE = /https?:\/\/[^\s)\]]+/g;

function countWords(turns: Array<{ text: string }>): number {
  return turns.reduce((sum, t) => {
    const cleaned = t.text
      .replace(EVIDENCE_PLACEHOLDER_RE, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\[.*?\]/g, '')
      .trim();
    return sum + cleaned.split(/\s+/).filter(Boolean).length;
  }, 0);
}

// ---- Main Entry Point ----

export function compileScript(input: CompileInput): CompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build evidence lookup
  const evidenceById = new Map(input.evidence.map(e => [e.evidenceId, e]));

  // Build source lookup
  const sourceById = new Map(input.sources.map(s => [s.sourceId, s]));

  // Step 1: Collect all evidence IDs cited in the script
  const citedEvidenceIds = new Set<string>();
  for (const turn of input.turns) {
    const matches = turn.text.matchAll(EVIDENCE_PLACEHOLDER_RE);
    for (const match of matches) {
      citedEvidenceIds.add(`ev_${match[1]}`);
    }
  }

  // Step 2: Validate evidence IDs exist in dossier
  for (const evId of citedEvidenceIds) {
    if (!evidenceById.has(evId)) {
      errors.push(`Evidence ${evId} cited in script but not found in dossier`);
    }
  }

  // Step 3: Build evidence → source → reference number mapping
  const usedSourceIds = new Set<string>();
  const evidenceToSourceMap: Record<string, string[]> = {};

  for (const evId of citedEvidenceIds) {
    const ev = evidenceById.get(evId);
    if (ev) {
      evidenceToSourceMap[evId] = ev.sourceIds;
      for (const sid of ev.sourceIds) {
        usedSourceIds.add(sid);
      }
    }
  }

  // Assign reference numbers to sources (in order of first appearance)
  const sourceToRefNumber = new Map<string, number>();
  let refNumber = 1;

  for (const turn of input.turns) {
    const matches = [...turn.text.matchAll(EVIDENCE_PLACEHOLDER_RE)];
    for (const match of matches) {
      const evId = `ev_${match[1]}`;
      const ev = evidenceById.get(evId);
      if (ev) {
        for (const sid of ev.sourceIds) {
          if (!sourceToRefNumber.has(sid)) {
            sourceToRefNumber.set(sid, refNumber++);
          }
        }
      }
    }
  }

  // Step 4: Replace [[ev_*]] with [N] in turn text
  const compiledTurns = input.turns.map(turn => {
    let text = turn.text;

    text = text.replace(EVIDENCE_PLACEHOLDER_RE, (_match, id) => {
      const evId = `ev_${id}`;
      const ev = evidenceById.get(evId);
      if (!ev) return ''; // already flagged as error

      // Pick the primary source (first one) for the footnote number
      const primarySourceId = ev.sourceIds[0];
      const num = primarySourceId ? sourceToRefNumber.get(primarySourceId) : undefined;
      return num ? `[${num}]` : '';
    });

    return { speaker: turn.speaker, text, direction: turn.direction };
  });

  // Step 5: Check for raw URLs (the writer shouldn't have introduced any)
  for (let i = 0; i < compiledTurns.length; i++) {
    const urls = compiledTurns[i].text.match(RAW_URL_RE);
    if (urls) {
      warnings.push(`Turn ${i} contains raw URL(s): ${urls.join(', ')}. These should be citations.`);
    }
  }

  // Step 6: Validate word count
  const wordCount = countWords(compiledTurns);
  const bounds = wordCountBounds(input.durationTarget);
  if (wordCount < bounds.min * 0.8) {
    warnings.push(`Word count ${wordCount} is significantly below minimum ${bounds.min}`);
  }
  if (wordCount > bounds.max * 1.2) {
    warnings.push(`Word count ${wordCount} is significantly above maximum ${bounds.max}`);
  }

  // Step 7: Validate reference count
  const minRefs = getMinReferenceCount(input.depth, input.durationTarget);
  if (sourceToRefNumber.size < minRefs) {
    warnings.push(`Only ${sourceToRefNumber.size} sources cited, minimum is ${minRefs} for ${input.depth} depth`);
  }

  // Step 8: Build final Reference[] array
  const references: CompiledReference[] = [];
  for (const [sourceId, num] of sourceToRefNumber) {
    const source = sourceById.get(sourceId);
    if (source) {
      references.push({
        number: num,
        sourceId,
        title: source.title,
        authors: source.authors.join(', '),
        year: source.year,
        url: source.canonicalUrl,
        doi: null,
        type: source.type,
        publisher: source.publisher,
      });
    } else {
      errors.push(`Source ${sourceId} referenced by evidence but not found in dossier`);
    }
  }

  references.sort((a, b) => a.number - b.number);

  logger.info('Script compilation complete', {
    evidenceCited: citedEvidenceIds.size,
    sourcesUsed: usedSourceIds.size,
    references: references.length,
    wordCount,
    errors: errors.length,
    warnings: warnings.length,
  });

  return {
    success: errors.length === 0,
    turns: compiledTurns,
    references,
    errors,
    warnings,
    evidenceToSourceMap,
    stats: {
      totalEvidenceCited: citedEvidenceIds.size,
      totalSourcesUsed: usedSourceIds.size,
      totalReferences: references.length,
      wordCount,
    },
  };
}
