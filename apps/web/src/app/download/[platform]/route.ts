import { NextRequest, NextResponse } from 'next/server';

type RouteParams = { params: Promise<{ platform: string }> };

type DesktopPlatform = 'mac' | 'windows' | 'linux';

interface DesktopDownloadManifest {
  version?: string;
  platform?: string;
  primary?: {
    href?: string;
    filename?: string;
    contentType?: string;
    size?: number;
  };
}

const PLATFORMS = new Set<DesktopPlatform>(['mac', 'windows', 'linux']);

function isDesktopPlatform(value: string): value is DesktopPlatform {
  return PLATFORMS.has(value as DesktopPlatform);
}

function normalizeVersion(value: string | null): string {
  if (!value || value === 'latest') return 'latest';
  return value.startsWith('v') ? value : `v${value}`;
}

function getDesktopDownloadBaseUrl(): string | null {
  const baseUrl =
    process.env.DESKTOP_DOWNLOAD_BASE_URL ||
    process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL ||
    process.env.R2_PUBLIC_URL;

  return baseUrl ? baseUrl.replace(/\/+$/, '') : null;
}

function getManifestUrl(baseUrl: string, version: string, platform: DesktopPlatform): string {
  return `${baseUrl}/download/desktop/${encodeURIComponent(version)}/${platform}/manifest.json`;
}

function resolveDownloadUrl(manifestUrl: string, manifest: DesktopDownloadManifest): string | null {
  const href = manifest.primary?.href;
  if (!href) return null;
  return new URL(href, manifestUrl).toString();
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { platform } = await params;

  if (!isDesktopPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported desktop platform.' }, { status: 404 });
  }

  const baseUrl = getDesktopDownloadBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Desktop downloads are not configured for this deployment.' },
      { status: 503 }
    );
  }

  const version = normalizeVersion(request.nextUrl.searchParams.get('version'));
  const manifestUrl = getManifestUrl(baseUrl, version, platform);

  let manifestResponse: Response;
  try {
    manifestResponse = await fetch(manifestUrl, { next: { revalidate: 300 } });
  } catch {
    return NextResponse.json(
      { error: 'Desktop download manifest could not be reached.' },
      { status: 502 }
    );
  }

  if (!manifestResponse.ok) {
    return NextResponse.json(
      { error: 'Desktop build has not been published yet.', platform, version },
      { status: 404 }
    );
  }

  const manifest = (await manifestResponse.json()) as DesktopDownloadManifest;
  const downloadUrl = resolveDownloadUrl(manifestUrl, manifest);

  if (!downloadUrl) {
    return NextResponse.json(
      { error: 'Desktop download manifest is missing a primary file.' },
      { status: 502 }
    );
  }

  return NextResponse.redirect(downloadUrl, 307);
}
