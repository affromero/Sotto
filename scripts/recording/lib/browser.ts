/* eslint-disable no-console */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { encode } from 'next-auth/jwt';
import * as fs from 'fs';
import * as path from 'path';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── Session Token ─────────────────────────────────────────────────

export async function createSessionToken(
  userId: string,
  role: string,
  name: string
): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET not set');

  return encode({
    token: { sub: userId, role, name, email: `${role.toLowerCase()}@sotto.fm` },
    secret,
    salt: APP_URL.startsWith('https')
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token',
  });
}

export function getCookieName(): string {
  return APP_URL.startsWith('https')
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

// ── Health Check ──────────────────────────────────────────────────

export async function checkAppHealth(appUrl: string): Promise<void> {
  try {
    const res = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`Health check passed: ${appUrl}`);
  } catch (err) {
    throw new Error(
      `App unreachable at ${appUrl}. Start it with \`npm run dev\` first.\n${err}`
    );
  }
}

// ── Browser Launch ────────────────────────────────────────────────

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    throw new Error(
      'Chromium not found. Install it with: npx playwright install chromium'
    );
  }
}

// ── Recording Context ─────────────────────────────────────────────

export async function createRecordingContext(
  browser: Browser,
  viewport: { width: number; height: number },
  auth: 'none' | 'demo' | 'admin' | 'viewer',
  tokens: Record<string, string>,
  videoDir: string
): Promise<BrowserContext> {
  fs.mkdirSync(videoDir, { recursive: true });

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    recordVideo: {
      dir: videoDir,
      size: { width: viewport.width, height: viewport.height },
    },
  });

  if (auth !== 'none') {
    const token = tokens[auth];
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

  return context;
}

// ── Finalize Recording ────────────────────────────────────────────

export async function finalizeRecording(
  context: BrowserContext,
  flowName: string,
  outputDir: string
): Promise<string> {
  const pages = context.pages();
  if (pages.length === 0) {
    await context.close();
    throw new Error(`No pages found for flow: ${flowName}`);
  }

  // Get the video path before closing
  const video = pages[0].video();
  await context.close();

  if (!video) {
    throw new Error(`No video recorded for flow: ${flowName}`);
  }

  const rawPath = await video.path();
  const destPath = path.join(outputDir, `${flowName}-raw.webm`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(rawPath, destPath);
  console.log(`  Raw recording saved: ${destPath}`);
  return destPath;
}
