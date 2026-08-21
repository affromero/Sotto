// Replays reference verification against real stored data, WITHOUT spending
// AI/TTS credits: re-runs domain classification and Bayesian scoring with the
// CURRENT code over every persisted reference check, and reports which
// references flip verdicts. Run it against production before deploying any
// classifier/scorer change:
//
//   ssh sotto-prod "docker exec sotto-prod-postgres psql -U sotto -d sotto_personal -t -A -c \
//     \"SELECT COALESCE(json_agg(row_to_json(t)), '[]') FROM (
//        SELECT r.number, r.doi, r.type, r.url,
//               r.\\\"verificationStatus\\\" AS status, r.\\\"verificationDetails\\\" AS details,
//               e.id AS episode_id, e.\\\"createdAt\\\" AS episode_created_at, e.topic
//        FROM \\\"Reference\\\" r JOIN \\\"Episode\\\" e ON e.id = r.\\\"episodeId\\\"
//        WHERE r.\\\"verificationDetails\\\" IS NOT NULL
//          AND e.\\\"createdAt\\\" > now() - interval '14 days'
//        ORDER BY e.\\\"createdAt\\\", r.number) t\"" \
//   | npx tsx scripts/replay-verification.ts
//
// Stored checks are normalized to current semantics (layers that no longer run
// are dropped; infra-error confidences remapped to neutral) so historical rows
// recorded under older code replay faithfully.
/* eslint-disable no-console -- CLI report tool; stdout is the deliverable */
import { readFileSync } from 'node:fs';
import { computeBayesianScore, type LayerResult } from 'groundcheck';
import { classifyEpisodeReference } from '../src/lib/reference-verification/classify-episode-reference';

interface StoredCheck {
  layer: string;
  passed: boolean;
  confidence: number;
  detail: string;
}

interface ReferenceRow {
  number: number;
  doi: string | null;
  type: string | null;
  url: string | null;
  status: string;
  details: { checks?: StoredCheck[]; posterior?: number } | null;
  episode_id: string;
  episode_created_at: string;
  topic: string | null;
}

const INFRA_ERROR_PATTERNS = [
  /check failed:/i, // fetch throw/timeout in any layer
  /OpenAlex returned \d+/i, // OpenAlex non-ok status
  /URL returned (403|405|429)/i, // bot-blocked HEAD probe
];

function normalizeChecks(
  checks: StoredCheck[],
  ref: { doi: string | null; url: string | null }
): LayerResult[] {
  const results: LayerResult[] = [];
  for (const check of checks) {
    if (check.layer === 'grounding') continue;
    // Layers that no longer run when their input is absent.
    if (check.layer === 'doi' && !ref.doi?.trim()) continue;
    if (check.layer === 'url' && !ref.url?.trim()) continue;
    const isInfraError = INFRA_ERROR_PATTERNS.some((p) => p.test(check.detail));
    results.push({
      layerId: check.layer as LayerResult['layerId'],
      passed: check.passed,
      confidence: isInfraError && !check.passed ? 0.5 : check.confidence,
    });
  }
  return results;
}

function main() {
  const inputPath = process.argv[2];
  const raw = readFileSync(inputPath ?? 0, 'utf8').trim();
  const rows: ReferenceRow[] = JSON.parse(raw);

  let flippedToVerified = 0;
  let stillFailing = 0;
  let regressions = 0;
  let currentEpisode = '';

  for (const ref of rows) {
    if (!ref.details?.checks?.length) continue;

    if (ref.episode_id !== currentEpisode) {
      currentEpisode = ref.episode_id;
      console.log(
        `\n=== ${ref.episode_created_at.slice(0, 16)} — ${ref.topic ?? 'untitled'} (${ref.episode_id})`
      );
    }

    const domain = classifyEpisodeReference({ doi: ref.doi, url: ref.url, type: ref.type });
    const layerResults = normalizeChecks(ref.details.checks, ref);
    const { posterior, verdict: rawVerdict } = computeBayesianScore(domain, layerResults);
    const aiCheck = ref.details.checks.find((c) => c.layer === 'ai');
    const verified = rawVerdict === 'VERIFIED' && aiCheck?.passed === true;

    const before = ref.status;
    const after = verified ? 'VERIFIED' : 'FAILED';
    const marker = before === after ? '  ' : before === 'FAILED' ? '✚ ' : '✖ ';
    if (before === 'FAILED' && after === 'VERIFIED') flippedToVerified++;
    if (before === 'VERIFIED' && after === 'FAILED') regressions++;
    if (after === 'FAILED') stillFailing++;

    console.log(
      `${marker}[${ref.number}] ${ref.type ?? '?'} → ${domain}  ` +
        `${before}(${(ref.details.posterior ?? 0).toFixed(2)}) → ${after}(${posterior.toFixed(2)})  ` +
        `ai:${aiCheck?.passed ? 'pass' : 'FAIL'}  ${ref.url ?? ref.doi ?? ''}`
    );
    if (after === 'FAILED') {
      for (const c of ref.details.checks) {
        console.log(`     ${c.layer}: passed=${c.passed} c=${c.confidence} — ${c.detail}`);
      }
    }
  }

  console.log(
    `\nSummary: ${rows.length} references replayed — ` +
      `${flippedToVerified} previously-FAILED now verify, ` +
      `${regressions} regressions, ${stillFailing} still failing.`
  );
  if (regressions > 0) process.exitCode = 1;
}

main();
