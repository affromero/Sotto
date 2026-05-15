/* eslint-disable no-console */
/**
 * Sotto Screen Recording Pipeline
 *
 * Records key product flows via Playwright, then color-grades with FFmpeg.
 *
 * Prerequisites:
 *   - App running at APP_URL (default http://localhost:3000)
 *   - Demo data seeded: cd apps/web && npx tsx prisma/seed-demo.ts
 *   - Playwright browsers installed: npx playwright install chromium
 *   - NEXTAUTH_SECRET set (via Doppler)
 *
 * Usage:
 *   doppler run -- npx tsx scripts/recording/index.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import {
  checkAppHealth,
  createSessionToken,
  launchBrowser,
  createRecordingContext,
  finalizeRecording,
} from './lib/browser';
import { gradeRecording } from './lib/grade';
import type { FlowContext, FlowScenario, RecordingManifest, OutputFormat } from './lib/types';

// Flows
import chatCreation from './flows/02-chat-creation';
import playerInterrupt from './flows/03-player-interrupt';
import forkFlow from './flows/04-fork-flow';
import scriptReview from './flows/05-script-review';
import landingPage from './flows/06-landing-page';
import verificationGithub from './flows/07-verification-github';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const OUTPUT_DIR = '/tmp/pitch-recordings';
const RAW_DIR = path.join(OUTPUT_DIR, 'raw');
const GRADED_DIR = path.join(OUTPUT_DIR, 'graded');
const FORMATS: OutputFormat[] = ['mp4', 'webm', 'gif'];

const ALL_FLOWS: FlowScenario[] = [
  chatCreation,
  playerInterrupt,
  forkFlow,
  scriptReview,
  landingPage,
  verificationGithub,
];

async function main() {
  console.log('=== Sotto Screen Recording Pipeline ===\n');
  console.log(`App URL: ${APP_URL}`);
  console.log(`Output:  ${OUTPUT_DIR}\n`);

  // ── Health check ────────────────────────────────────────────────
  await checkAppHealth(APP_URL);

  // ── Prepare output dirs ─────────────────────────────────────────
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(GRADED_DIR, { recursive: true });

  // ── Connect to database ─────────────────────────────────────────
  const prisma = new PrismaClient();
  try {
    // Use the real admin account for recordings, fallback to seeded demo user
    const demoUser =
      (await prisma.user.findFirst({ where: { email: 'andres2912@gmail.com' } })) ??
      (await prisma.user.findUnique({ where: { email: 'demo@sotto.fm' } }));
    if (!demoUser) throw new Error('No admin or demo user found — run seed:demo first');

    // Find key podcasts (by title, regardless of owner)
    const cryptoPodcast = await prisma.podcast.findFirst({
      where: { title: 'The Hidden History of Cryptography' },
    });
    const scriptReadyPodcast = await prisma.podcast.findFirst({
      where: { status: 'SCRIPT_READY' },
    });

    if (!cryptoPodcast) throw new Error('Cryptography podcast not found — run seed:demo first');
    if (!scriptReadyPodcast)
      throw new Error('SCRIPT_READY podcast not found — run seed:demo first');

    // Reassign podcasts to the recording user so their profile shows in recordings
    if (cryptoPodcast.userId !== demoUser.id) {
      await prisma.podcast.update({
        where: { id: cryptoPodcast.id },
        data: { userId: demoUser.id },
      });
      console.log(`  Reassigned cryptography podcast to ${demoUser.email}`);
    }
    if (scriptReadyPodcast.userId !== demoUser.id) {
      await prisma.podcast.update({
        where: { id: scriptReadyPodcast.id },
        data: { userId: demoUser.id },
      });
      console.log(`  Reassigned script-ready podcast to ${demoUser.email}`);
    }

    console.log(`Demo user:         ${demoUser.id}`);
    console.log(`Crypto podcast:    ${cryptoPodcast.id}`);
    console.log(`ScriptReady:       ${scriptReadyPodcast.id}\n`);

    // Find a non-owner user for fork flow
    const viewerUser = await prisma.user.findUnique({ where: { email: 'maria.chen@example.com' } });
    if (!viewerUser) throw new Error('Viewer user (Maria Chen) not found — run seed:demo first');

    // ── Create session tokens ───────────────────────────────────────
    const tokens: Record<string, string> = {
      demo: await createSessionToken(demoUser.id, demoUser.role, demoUser.name || 'Demo User'),
      viewer: await createSessionToken(
        viewerUser.id,
        viewerUser.role,
        viewerUser.name || 'Maria Chen'
      ),
    };

    const ctx: FlowContext = {
      appUrl: APP_URL,
      demoUser: { id: demoUser.id, email: demoUser.email },
      demoPodcasts: {
        cryptography: { id: cryptoPodcast.id, title: cryptoPodcast.title },
        scriptReady: { id: scriptReadyPodcast.id, title: scriptReadyPodcast.title },
      },
      tokens,
    };

    // ── Launch browser ────────────────────────────────────────────
    const browser = await launchBrowser();
    console.log('Browser launched\n');

    // ── Record each flow ──────────────────────────────────────────
    const manifest: RecordingManifest = {
      createdAt: new Date().toISOString(),
      appUrl: APP_URL,
      flows: [],
    };

    for (const flow of ALL_FLOWS) {
      console.log(`Recording: ${flow.name} — ${flow.description}`);
      const videoDir = path.join(RAW_DIR, flow.name);

      try {
        const context = await createRecordingContext(
          browser,
          flow.viewport,
          flow.auth,
          tokens,
          videoDir
        );

        const page = await context.newPage();
        await flow.run(page, ctx);

        const rawPath = await finalizeRecording(context, flow.name, RAW_DIR);

        // Grade the recording
        console.log(`  Grading: ${flow.name}`);
        const results = await gradeRecording({
          input: rawPath,
          outputDir: GRADED_DIR,
          name: flow.name,
          formats: FORMATS,
        });

        manifest.flows.push({
          name: flow.name,
          description: flow.description,
          rawPath,
          outputs: results,
        });

        console.log(`  Done: ${flow.name} (${results.length} outputs)\n`);
      } catch (err) {
        console.error(`  Error recording ${flow.name}:`, err);
        console.log('  Continuing with next flow...\n');
      }
    }

    await browser.close();

    // ── Write manifest ──────────────────────────────────────────────
    const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Manifest: ${manifestPath}`);

    // ── Summary ─────────────────────────────────────────────────────
    const totalFiles = manifest.flows.reduce((n, f) => n + f.outputs.length, 0);
    const totalSize = manifest.flows.flatMap((f) => f.outputs).reduce((n, o) => n + o.sizeBytes, 0);

    console.log('\n=== Recording Pipeline Complete ===');
    console.log(`  Flows recorded: ${manifest.flows.length}/${ALL_FLOWS.length}`);
    console.log(`  Output files:   ${totalFiles}`);
    console.log(`  Total size:     ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
    console.log(`  Output dir:     ${OUTPUT_DIR}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Recording pipeline failed:', err);
  process.exit(1);
});
