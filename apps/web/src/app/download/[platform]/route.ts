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
const DEFAULT_LATEST_DESKTOP_VERSION = 'v0.1';
const DEFAULT_GITHUB_RELEASE_BASE_URL = 'https://github.com/affromero/Sotto/releases/download';
const GITHUB_RELEASE_EXTENSIONS: Record<DesktopPlatform, string> = {
  mac: 'dmg',
  windows: 'msi',
  linux: 'AppImage',
};

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

function getGithubReleaseBaseUrl(): string {
  return (process.env.DESKTOP_GITHUB_RELEASE_BASE_URL || DEFAULT_GITHUB_RELEASE_BASE_URL).replace(
    /\/+$/,
    ''
  );
}

function getLatestDesktopVersion(): string {
  return normalizeVersion(
    process.env.DESKTOP_LATEST_VERSION ||
      process.env.NEXT_PUBLIC_DESKTOP_LATEST_VERSION ||
      DEFAULT_LATEST_DESKTOP_VERSION
  );
}

function getManifestUrl(baseUrl: string, version: string, platform: DesktopPlatform): string {
  return `${baseUrl}/download/desktop/${encodeURIComponent(version)}/${platform}/manifest.json`;
}

function resolveDownloadUrl(manifestUrl: string, manifest: DesktopDownloadManifest): string | null {
  const href = manifest.primary?.href;
  if (!href) return null;
  return new URL(href, manifestUrl).toString();
}

function getGithubReleaseDownloadUrl(version: string, platform: DesktopPlatform): string {
  const releaseVersion = version === 'latest' ? getLatestDesktopVersion() : version;
  const filename = `sotto-host-${releaseVersion}-${platform}.${GITHUB_RELEASE_EXTENSIONS[platform]}`;
  return `${getGithubReleaseBaseUrl()}/${encodeURIComponent(releaseVersion)}/${encodeURIComponent(
    filename
  )}`;
}

function redirectToGithubRelease(version: string, platform: DesktopPlatform): NextResponse {
  return NextResponse.redirect(getGithubReleaseDownloadUrl(version, platform), 307);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { platform } = await params;

  if (!isDesktopPlatform(platform)) {
    return NextResponse.json({ error: 'Unsupported desktop platform.' }, { status: 404 });
  }

  const baseUrl = getDesktopDownloadBaseUrl();
  const version = normalizeVersion(request.nextUrl.searchParams.get('version'));

  if (!baseUrl) {
    return redirectToGithubRelease(version, platform);
  }

  const manifestUrl = getManifestUrl(baseUrl, version, platform);

  let manifestResponse: Response;
  try {
    manifestResponse = await fetch(manifestUrl, { next: { revalidate: 300 } });
  } catch {
    return redirectToGithubRelease(version, platform);
  }

  if (!manifestResponse.ok) {
    return redirectToGithubRelease(version, platform);
  }

  const manifest = (await manifestResponse.json()) as DesktopDownloadManifest;
  const downloadUrl = resolveDownloadUrl(manifestUrl, manifest);

  if (!downloadUrl) {
    return redirectToGithubRelease(version, platform);
  }

  return NextResponse.redirect(downloadUrl, 307);
}
