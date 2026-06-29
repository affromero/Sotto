import { NextResponse } from 'next/server';
import packageJson from '../../../../package.json';

export const dynamic = 'force-dynamic';

const DEFAULT_GITHUB_REPOSITORY = 'affromero/Sotto';
const DEFAULT_DESKTOP_LATEST_VERSION = 'v0.1.0';

type GithubLatestRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
};

function getCurrentCommit(): string {
  return process.env.COMMIT_SHA || process.env.NEXT_PUBLIC_COMMIT_SHA || 'dev';
}

function normalizeDesktopVersion(value: string | undefined): string {
  const version = value?.trim();
  if (!version) return DEFAULT_DESKTOP_LATEST_VERSION;
  if (version === 'latest') return version;
  const shortSemver = version.match(/^v?(\d+)\.(\d+)$/);
  if (shortSemver) return `v${shortSemver[1]}.${shortSemver[2]}.0`;
  if (version.startsWith('v')) return version;
  return `v${version}`;
}

function normalizeComparableVersion(value: string): string {
  const parts = value.trim().replace(/^v/i, '').split('.').filter(Boolean);

  while (parts.length < 3) {
    parts.push('0');
  }

  return parts.slice(0, 3).join('.');
}

function getGithubRepository(): string {
  const rawRepository =
    process.env.NEXT_PUBLIC_GITHUB_REPOSITORY ||
    process.env.GITHUB_REPOSITORY ||
    DEFAULT_GITHUB_REPOSITORY;

  return rawRepository
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
}

async function getLatestRelease() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${getGithubRepository()}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        next: { revalidate: 300 },
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as GithubLatestRelease;
    if (typeof data.tag_name !== 'string') return null;

    return {
      version: data.tag_name,
      url: typeof data.html_url === 'string' ? data.html_url : null,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const latest = await getLatestRelease();
  const current = packageJson.version;
  const desktopLatest = normalizeDesktopVersion(
    process.env.DESKTOP_LATEST_VERSION || process.env.NEXT_PUBLIC_DESKTOP_LATEST_VERSION
  );

  return NextResponse.json({
    current,
    version: current,
    commit: getCurrentCommit(),
    latest,
    updateAvailable: latest
      ? normalizeComparableVersion(latest.version) !== normalizeComparableVersion(current)
      : false,
    desktop: {
      latest: desktopLatest,
      downloads: {
        mac: '/download/mac',
        windows: '/download/windows',
        linux: '/download/linux',
      },
    },
  });
}
