/* eslint-disable no-console */
/**
 * Narrated Video Pipeline
 *
 * Takes the existing graded screen recordings and adds time-synced
 * voiceover narration using Hume TTS (Vince Douglas voice).
 *
 * Prerequisites:
 *   - Graded recordings exist in /tmp/pitch-recordings/graded/
 *   - HUME_API_KEY set (via Doppler)
 *
 * Usage:
 *   doppler run -- npx tsx scripts/recording/narrate.ts
 *
 * Output:
 *   /tmp/pitch-recordings/narrated/*.mp4
 */

import * as fs from 'fs';
import * as path from 'path';

import { ALL_NARRATIONS } from './narration/scripts';
import { generateFlowVoiceover } from './narration/generate-voiceover';
import { compositeNarratedVideo } from './narration/composite';

const RECORDINGS_DIR = '/tmp/pitch-recordings';
const GRADED_DIR = path.join(RECORDINGS_DIR, 'graded');
const VOICEOVER_DIR = path.join(RECORDINGS_DIR, 'voiceover');
const NARRATED_DIR = path.join(RECORDINGS_DIR, 'narrated');

async function main() {
  console.log('=== Sotto Narrated Video Pipeline ===\n');

  // ── Validate prerequisites ──────────────────────────────────────
  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) {
    throw new Error('HUME_API_KEY not set — run with: doppler run -- npx tsx scripts/recording/narrate.ts');
  }

  if (!fs.existsSync(GRADED_DIR)) {
    throw new Error(`Graded recordings not found at ${GRADED_DIR} — run the recording pipeline first`);
  }

  // ── Create output directories ───────────────────────────────────
  fs.mkdirSync(VOICEOVER_DIR, { recursive: true });
  fs.mkdirSync(NARRATED_DIR, { recursive: true });

  // ── Phase 1: Generate voiceover segments ────────────────────────
  console.log('Phase 1: Generating voiceover with Hume TTS (Vince Douglas)\n');

  const totalSegments = ALL_NARRATIONS.reduce((n, f) => n + f.segments.length, 0);
  console.log(`  ${ALL_NARRATIONS.length} flows, ${totalSegments} segments total\n`);

  const voiceovers = [];
  for (const narration of ALL_NARRATIONS) {
    const videoPath = path.join(GRADED_DIR, `${narration.sourceFlowName}.mp4`);
    if (!fs.existsSync(videoPath)) {
      console.log(`  Skipping ${narration.flowName} — no graded MP4 (${narration.sourceFlowName})`);
      continue;
    }

    console.log(`  Generating voiceover for ${narration.flowName} (source: ${narration.sourceFlowName})...`);
    const voiceover = await generateFlowVoiceover(narration, VOICEOVER_DIR, apiKey);
    voiceovers.push(voiceover);
    console.log(`  Done: ${voiceover.segments.length} segments\n`);
  }

  // ── Phase 2: Composite narrated videos ──────────────────────────
  console.log('Phase 2: Compositing narrated videos\n');

  const results = [];
  for (const voiceover of voiceovers) {
    const narration = ALL_NARRATIONS.find((n) => n.flowName === voiceover.flowName);
    const sourceFlowName = narration?.sourceFlowName ?? voiceover.flowName;
    const videoPath = path.join(GRADED_DIR, `${sourceFlowName}.mp4`);

    console.log(`  Compositing ${voiceover.flowName}...`);
    const result = await compositeNarratedVideo({
      videoPath,
      voiceover,
      outputDir: NARRATED_DIR,
    });

    results.push(result);
    const slowNote = result.slowFactor > 1 ? ` [${result.slowFactor.toFixed(2)}x slower]` : '';
    console.log(`  → ${result.outputPath} (${(result.sizeBytes / 1024 / 1024).toFixed(1)}MB)${slowNote}\n`);
  }

  // ── Summary ─────────────────────────────────────────────────────
  const totalSize = results.reduce((n, r) => n + r.sizeBytes, 0);

  console.log('\n=== Narration Pipeline Complete ===');
  console.log(`  Flows narrated: ${results.length}/${ALL_NARRATIONS.length}`);
  console.log(`  Total size:     ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  Voiceover dir:  ${VOICEOVER_DIR}`);
  console.log(`  Narrated dir:   ${NARRATED_DIR}`);
  console.log('\n  Files:');
  for (const r of results) {
    console.log(`    ${r.flowName}: ${r.outputPath}`);
  }
}

main().catch((err) => {
  console.error('Narration pipeline failed:', err);
  process.exit(1);
});
