import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  userId: null as string | null,
  episode: null as null | {
    id: string;
    userId: string;
    visibility: string;
    title: string;
    topic: string;
    user: { name: string };
  },
  shareable: null as null | {
    title: string;
    topic: string;
    duration: number | null;
    user: { name: string };
  },
}));
vi.mock('@/lib/auth', () => ({
  auth: async () => (boundary.userId ? { user: { id: boundary.userId } } : null),
}));
vi.mock('@/lib/episode-data', () => ({
  getEpisodeForDetailPage: async () => boundary.episode,
  getShareableEpisodeMetadata: async () => boundary.shareable,
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/r2', () => ({ resolveAudioUrl: vi.fn() }));
vi.mock('@/app/episode/[episodeId]/EpisodePlayerView', () => ({ EpisodePlayerView: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('Not found');
  },
}));
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(
      public element: unknown,
      public options: unknown
    ) {}
  },
}));

import { generateMetadata } from '@/app/episode/[episodeId]/page';
import OgImage from '@/app/episode/[episodeId]/opengraph-image';

describe('episode metadata privacy', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    boundary.userId = null;
    boundary.shareable = null;
    boundary.episode = {
      id: 'episode',
      userId: 'owner',
      visibility: 'PRIVATE',
      title: 'Private title',
      topic: 'Private topic',
      user: { name: 'Owner' },
    };
  });
  afterEach(() => vi.unstubAllEnvs());
  const props = { params: Promise.resolve({ episodeId: 'episode' }) };

  it('returns generic metadata for anonymous and other-profile private requests', async () => {
    expect(await generateMetadata(props)).toEqual({ title: 'Lesson Not Found' });
    boundary.userId = 'other';
    expect(await generateMetadata(props)).toEqual({ title: 'Lesson Not Found' });
  });

  it('keeps owner and unlisted episode metadata available', async () => {
    boundary.userId = 'owner';
    expect(await generateMetadata(props)).toMatchObject({ title: 'Private title' });
    boundary.userId = null;
    boundary.episode!.visibility = 'UNLISTED';
    expect(await generateMetadata(props)).toMatchObject({ title: 'Private title' });
  });

  it('returns generic metadata when the protected loader denies an assessment', async () => {
    boundary.userId = 'owner';
    boundary.episode = null;
    expect(await generateMetadata(props)).toEqual({ title: 'Lesson Not Found' });
  });

  it('renders a generic share image when the anonymous loader denies a lesson', async () => {
    const image = (await OgImage(props)) as unknown as {
      element: unknown;
      options: { headers: Record<string, string> };
    };
    expect(JSON.stringify(image.element)).toContain('Lesson Not Found');
    expect(JSON.stringify(image.element)).not.toContain('Private title');
    expect(image.options.headers['Cache-Control']).toBe('private, no-store');
  });

  it('renders a shareable lesson in the image', async () => {
    boundary.shareable = {
      title: 'Shared lesson',
      topic: 'Greetings',
      duration: 60,
      user: { name: 'Owner' },
    };
    const image = (await OgImage(props)) as unknown as { element: unknown };
    expect(JSON.stringify(image.element)).toContain('Shared lesson');
  });
});
