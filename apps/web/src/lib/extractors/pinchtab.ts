import { logger } from '../logger';

const PINCHTAB_TIMEOUT_MS = 30000;

/**
 * Check if Pinchtab headless Chrome is configured.
 */
export function isPinchtabAvailable(): boolean {
  return !!process.env.PINCHTAB_URL;
}

/**
 * Extract page content via Pinchtab (headless Chrome + Readability).
 * POST /navigate to load the page, then GET /text for extracted content.
 * Throws on any error — caller should catch and fall back.
 */
export async function extractViaPinchtab(url: string): Promise<string> {
  const baseUrl = process.env.PINCHTAB_URL;
  if (!baseUrl) {
    throw new Error('PINCHTAB_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PINCHTAB_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (process.env.PINCHTAB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.PINCHTAB_TOKEN}`;
  }

  try {
    // Step 1: Navigate to the URL
    const navResponse = await fetch(`${baseUrl}/navigate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!navResponse.ok) {
      const body = await navResponse.text().catch(() => '');
      throw new Error(`Pinchtab /navigate failed: HTTP ${navResponse.status} — ${body}`);
    }

    // Step 2: Extract text content (Readability mode is the default)
    const textResponse = await fetch(`${baseUrl}/text`, {
      headers,
      signal: controller.signal,
    });

    if (!textResponse.ok) {
      const body = await textResponse.text().catch(() => '');
      throw new Error(`Pinchtab /text failed: HTTP ${textResponse.status} — ${body}`);
    }

    const data = (await textResponse.json()) as { text?: string };
    if (!data.text) {
      throw new Error('Pinchtab /text returned empty content');
    }

    logger.info('Pinchtab extraction succeeded', { url, length: data.text.length });
    return data.text;
  } finally {
    clearTimeout(timeout);
  }
}
