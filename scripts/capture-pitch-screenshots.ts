/* eslint-disable no-console */
/**
 * Capture screenshots of the live Sotto app for the pitch deck.
 *
 * Uses Playwright to navigate key pages, captures PNGs, uploads to R2.
 * Outputs a manifest.json mapping screenshot names to R2 URLs.
 *
 * Prerequisites:
 *   - App running at APP_URL (default http://localhost:3000)
 *   - Demo data seeded (prisma/seed-demo.ts)
 *   - R2 env vars set
 *   - NEXTAUTH_SECRET set
 *   - Playwright browsers installed: npx playwright install chromium
 *
 * Usage:
 *   npx tsx scripts/capture-pitch-screenshots.ts
 */

import { chromium, type Browser } from 'playwright';
import { encode } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = '/tmp/pitch-screenshots';

// ── R2 Client ─────────────────────────────────────────────────────

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sotto-storage';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

function createR2Client(): S3Client | null {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadToR2(client: S3Client, key: string, body: Buffer): Promise<string> {
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=3600',
    })
  );
  return R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : key;
}

// ── Session Token ─────────────────────────────────────────────────

async function createSessionToken(userId: string, role: string, name: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET not set');

  const token = await encode({
    token: { sub: userId, role, name, email: `${role.toLowerCase()}@sotto.fm` },
    secret,
    salt: APP_URL.startsWith('https') ? '__Secure-authjs.session-token' : 'authjs.session-token',
  });

  return token;
}

function getCookieName(): string {
  return APP_URL.startsWith('https') ? '__Secure-authjs.session-token' : 'authjs.session-token';
}

// ── Screenshot Definitions ────────────────────────────────────────

interface ScreenshotDef {
  name: string;
  path: string;
  viewport: { width: number; height: number };
  auth: 'none' | 'demo' | 'admin';
  fullPage: boolean;
  waitFor?: string;
}

function getScreenshotDefs(demoPodcastId: string): ScreenshotDef[] {
  return [
    // Desktop captures
    {
      name: 'landing',
      path: '/',
      viewport: { width: 1440, height: 900 },
      auth: 'none',
      fullPage: true,
    },
    {
      name: 'login',
      path: '/auth/login',
      viewport: { width: 1440, height: 900 },
      auth: 'none',
      fullPage: false,
    },
    {
      name: 'dashboard',
      path: '/dashboard',
      viewport: { width: 1440, height: 900 },
      auth: 'demo',
      fullPage: false,
      waitFor: '[class*="podcast"]',
    },
    {
      name: 'create',
      path: '/create',
      viewport: { width: 1440, height: 900 },
      auth: 'demo',
      fullPage: false,
    },
    {
      name: 'podcast-player',
      path: `/podcast/${demoPodcastId}`,
      viewport: { width: 1440, height: 900 },
      auth: 'none',
      fullPage: false,
    },
    {
      name: 'pricing',
      path: '/pricing',
      viewport: { width: 1440, height: 900 },
      auth: 'none',
      fullPage: false,
    },
    {
      name: 'billing',
      path: '/billing',
      viewport: { width: 1440, height: 900 },
      auth: 'demo',
      fullPage: false,
    },
    {
      name: 'admin-overview',
      path: '/admin',
      viewport: { width: 1440, height: 900 },
      auth: 'admin',
      fullPage: false,
    },
    {
      name: 'admin-users',
      path: '/admin/users',
      viewport: { width: 1440, height: 900 },
      auth: 'admin',
      fullPage: false,
    },
    {
      name: 'settings',
      path: '/settings',
      viewport: { width: 1440, height: 900 },
      auth: 'demo',
      fullPage: false,
    },

    // Mobile captures
    {
      name: 'mobile-landing',
      path: '/',
      viewport: { width: 390, height: 844 },
      auth: 'none',
      fullPage: true,
    },
    {
      name: 'mobile-dashboard',
      path: '/dashboard',
      viewport: { width: 390, height: 844 },
      auth: 'demo',
      fullPage: false,
    },
    {
      name: 'mobile-player',
      path: `/podcast/${demoPodcastId}`,
      viewport: { width: 390, height: 844 },
      auth: 'none',
      fullPage: false,
    },
  ];
}

// ── Capture Logic ─────────────────────────────────────────────────

async function captureScreenshot(
  browser: Browser,
  def: ScreenshotDef,
  tokens: Record<string, string>
): Promise<string> {
  const context = await browser.newContext({
    viewport: def.viewport,
    deviceScaleFactor: 2,
  });

  // Set session cookie if auth is needed
  if (def.auth !== 'none') {
    const token = tokens[def.auth];
    if (token) {
      const domain = new URL(APP_URL).hostname;
      await context.addCookies([
        {
          name: getCookieName(),
          value: token,
          domain,
          path: '/',
          httpOnly: true,
          secure: APP_URL.startsWith('https'),
          sameSite: 'Lax',
        },
      ]);
    }
  }

  const page = await context.newPage();
  const url = `${APP_URL}${def.path}`;

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for specific elements if specified
    if (def.waitFor) {
      await page.waitForSelector(def.waitFor, { timeout: 5000 }).catch(() => {
        // Non-fatal: element may not exist with current data
      });
    }

    // Small delay for any CSS transitions
    await page.waitForTimeout(500);

    const filePath = path.join(SCREENSHOT_DIR, `${def.name}.png`);
    await page.screenshot({
      path: filePath,
      fullPage: def.fullPage,
      type: 'png',
    });

    console.log(`  Captured: ${def.name} (${def.viewport.width}x${def.viewport.height})`);
    return filePath;
  } catch (err) {
    console.warn(`  Warning: Failed to capture ${def.name}: ${err}`);
    return '';
  } finally {
    await context.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('=== Capturing Pitch Screenshots ===\n');
  console.log(`App URL: ${APP_URL}`);

  // Prepare output directory
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Look up demo data from database
  const prisma = new PrismaClient();
  try {
    const demoUser = await prisma.user.findUnique({ where: { email: 'demo@sotto.fm' } });
    const adminUser = await prisma.user.findUnique({ where: { email: 'admin@sotto.fm' } });

    if (!demoUser) throw new Error('Demo user not found — run `npx tsx prisma/seed-demo.ts` first');
    if (!adminUser)
      throw new Error('Admin user not found — run `npx tsx prisma/seed-demo.ts` first');

    // Find a READY public podcast for player screenshots
    const demoPodcast = await prisma.podcast.findFirst({
      where: { userId: demoUser.id, status: 'READY', visibility: 'PUBLIC' },
      orderBy: { playCount: 'desc' },
    });

    if (!demoPodcast) throw new Error('No READY podcast found for demo user');

    console.log(`Demo user:    ${demoUser.id}`);
    console.log(`Admin user:   ${adminUser.id}`);
    console.log(`Demo podcast: ${demoPodcast.id} ("${demoPodcast.title}")\n`);

    // Create session tokens
    const tokens: Record<string, string> = {
      demo: await createSessionToken(demoUser.id, demoUser.role, demoUser.name || 'Alex Rivera'),
      admin: await createSessionToken(
        adminUser.id,
        adminUser.role,
        adminUser.name || 'Sotto Admin'
      ),
    };

    // Launch browser
    const browser = await chromium.launch({ headless: true });
    console.log('Browser launched\n');

    // Capture all screenshots
    const defs = getScreenshotDefs(demoPodcast.id);
    const captured: Record<string, string> = {};

    for (const def of defs) {
      const filePath = await captureScreenshot(browser, def, tokens);
      if (filePath) captured[def.name] = filePath;
    }

    await browser.close();
    console.log(`\nCaptured ${Object.keys(captured).length}/${defs.length} screenshots`);

    // Upload to R2
    const r2 = createR2Client();
    const manifest: Record<string, string> = {};

    if (r2) {
      console.log('\nUploading to R2...');
      for (const [name, filePath] of Object.entries(captured)) {
        const buffer = fs.readFileSync(filePath);
        const key = `pitch/screenshots/${name}.png`;
        const url = await uploadToR2(r2, key, buffer);
        manifest[name] = url;
        console.log(`  Uploaded: ${name} → ${url}`);
      }
    } else {
      console.log('\nR2 not configured — keeping local files only');
      for (const [name, filePath] of Object.entries(captured)) {
        manifest[name] = filePath;
      }
    }

    // Write manifest
    const manifestPath = path.join(SCREENSHOT_DIR, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written: ${manifestPath}`);
    console.log('Done!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
