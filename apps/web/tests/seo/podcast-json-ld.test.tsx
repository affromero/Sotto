import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PodcastJsonLd } from '@/components/player/PodcastJsonLd';

function renderAndParse(props: Parameters<typeof PodcastJsonLd>[0]) {
  const { container } = render(<PodcastJsonLd {...props} />);
  const script = container.querySelector('script[type="application/ld+json"]');
  expect(script).not.toBeNull();
  return JSON.parse(script!.textContent!);
}

const BASE_PROPS = {
  id: 'pod-123',
  title: 'Test Podcast',
  topic: 'A topic about testing',
  createdAt: '2026-01-15T10:00:00.000Z',
  duration: 3661,
  audioUrl: 'https://media.example.com/audio/pod-123.mp3',
  creator: { name: 'Jane Doe', handle: 'janedoe' },
};

describe('PodcastJsonLd', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders correct schema type and context', () => {
    const data = renderAndParse(BASE_PROPS);
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('PodcastEpisode');
  });

  it('includes name, description, url, and datePublished', () => {
    const data = renderAndParse(BASE_PROPS);
    expect(data.name).toBe('Test Podcast');
    expect(data.description).toBe('A topic about testing');
    expect(data.url).toBe('https://selfhost.example.com/podcast/pod-123');
    expect(data.datePublished).toBe('2026-01-15T10:00:00.000Z');
  });

  it('formats duration as ISO 8601', () => {
    const data = renderAndParse(BASE_PROPS);
    expect(data.duration).toBe('PT1H1M1S');
  });

  it('formats short durations correctly', () => {
    const data = renderAndParse({ ...BASE_PROPS, duration: 90 });
    expect(data.duration).toBe('PT1M30S');
  });

  it('handles zero duration', () => {
    const data = renderAndParse({ ...BASE_PROPS, duration: 0 });
    expect(data.duration).toBe('PT0S');
  });

  it('omits duration when null', () => {
    const data = renderAndParse({ ...BASE_PROPS, duration: null });
    expect(data.duration).toBeUndefined();
  });

  it('includes associatedMedia with audio URL', () => {
    const data = renderAndParse(BASE_PROPS);
    expect(data.associatedMedia).toEqual({
      '@type': 'MediaObject',
      contentUrl: 'https://media.example.com/audio/pod-123.mp3',
      encodingFormat: 'audio/mpeg',
    });
  });

  it('omits associatedMedia when audioUrl is null', () => {
    const data = renderAndParse({ ...BASE_PROPS, audioUrl: null });
    expect(data.associatedMedia).toBeUndefined();
  });

  it('includes partOfSeries when creator has handle', () => {
    const data = renderAndParse(BASE_PROPS);
    expect(data.partOfSeries).toEqual({
      '@type': 'PodcastSeries',
      name: "Jane Doe's Sotto Lessons",
      url: 'https://selfhost.example.com/@janedoe',
    });
  });

  it('omits partOfSeries when creator has no handle', () => {
    const data = renderAndParse({
      ...BASE_PROPS,
      creator: { name: 'Anonymous', handle: null },
    });
    expect(data.partOfSeries).toBeUndefined();
  });

  it('includes creator with name and url', () => {
    const data = renderAndParse(BASE_PROPS);
    expect(data.creator).toEqual({
      '@type': 'Person',
      name: 'Jane Doe',
      url: 'https://selfhost.example.com/@janedoe',
    });
  });

  it('creator falls back to Anonymous when name is null', () => {
    const data = renderAndParse({
      ...BASE_PROPS,
      creator: { name: null, handle: 'anon' },
    });
    expect(data.creator.name).toBe('Anonymous');
  });

  it('creator omits url when handle is null', () => {
    const data = renderAndParse({
      ...BASE_PROPS,
      creator: { name: 'Someone', handle: null },
    });
    expect(data.creator.url).toBeUndefined();
  });
});
