import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const PITCH_DIR = path.join(process.cwd(), '.pitch');

async function verifyPitchCookie(value: string, secret: string): Promise<boolean> {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return false;

  const timestamp = value.substring(0, separatorIndex);
  const signature = value.substring(separatorIndex + 1);
  if (!timestamp || !signature) return false;

  const age = Date.now() - parseInt(timestamp, 10);
  if (isNaN(age) || age < 0 || age > 30 * 24 * 60 * 60 * 1000) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp));

  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === signature;
}

async function authenticate(request: NextRequest): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET;
  const pitchPassword = process.env.PITCH_PASSWORD;
  if (!secret || !pitchPassword) return false;

  const cookie = request.cookies.get('sotto_pitch');
  if (!cookie?.value) return false;

  return verifyPitchCookie(cookie.value, secret);
}

function isValidSegment(segment: string): boolean {
  return (
    !segment.includes('..') &&
    !segment.includes('/') &&
    !segment.includes('\\') &&
    segment.length > 0
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const authenticated = await authenticate(request);
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const segments = (await params).path;

  // GET /api/pitch/manifest → return manifest.json
  if (segments.length === 1 && segments[0] === 'manifest') {
    try {
      const manifestPath = path.join(PITCH_DIR, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      return NextResponse.json(JSON.parse(content));
    } catch {
      return NextResponse.json({ error: 'No pitch builds found' }, { status: 404 });
    }
  }

  // GET /api/pitch/<version>/<filename.html> → return HTML content
  if (segments.length === 2) {
    const [version, filename] = segments;

    if (!isValidSegment(version) || !isValidSegment(filename)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!filename.endsWith('.html')) {
      return NextResponse.json({ error: 'Only HTML files are served' }, { status: 400 });
    }

    // Additional date format validation for version
    if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
      return NextResponse.json({ error: 'Invalid version format' }, { status: 400 });
    }

    try {
      const filePath = path.join(PITCH_DIR, version, filename);

      // Ensure resolved path is within PITCH_DIR
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(PITCH_DIR))) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      const content = await readFile(filePath, 'utf-8');
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    } catch {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
  }

  return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
}
