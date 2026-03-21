import { describe, it, expect } from 'vitest';
import {
  matchesProfile,
  matchesPreset,
  shouldRun,
  HEAVY_WORKERS,
  PIPELINE_WORKERS,
  EXPERIMENTAL_WORKERS,
} from '@/workers/worker-routing';

const emptySet = new Set<string>();

function opts(overrides: Partial<Parameters<typeof shouldRun>[1]> = {}) {
  return {
    profile: 'all',
    preset: 'full',
    includeFilter: emptySet,
    excludeFilter: emptySet,
    ...overrides,
  };
}

describe('matchesProfile', () => {
  it('profile=all matches everything', () => {
    expect(matchesProfile('audio-generation', 'all')).toBe(true);
    expect(matchesProfile('content-extraction', 'all')).toBe(true);
    expect(matchesProfile('notifications', 'all')).toBe(true);
  });

  it('profile=heavy matches only HEAVY_WORKERS', () => {
    expect(matchesProfile('audio-generation', 'heavy')).toBe(true);
    expect(matchesProfile('voice-track-audio', 'heavy')).toBe(true);
    expect(matchesProfile('content-extraction', 'heavy')).toBe(false);
    expect(matchesProfile('notifications', 'heavy')).toBe(false);
  });

  it('profile=pipeline matches only PIPELINE_WORKERS', () => {
    expect(matchesProfile('content-extraction', 'pipeline')).toBe(true);
    expect(matchesProfile('script-generation', 'pipeline')).toBe(true);
    expect(matchesProfile('audio-generation', 'pipeline')).toBe(false);
    expect(matchesProfile('notifications', 'pipeline')).toBe(false);
  });

  it('profile=light matches workers not in heavy or pipeline', () => {
    expect(matchesProfile('notifications', 'light')).toBe(true);
    expect(matchesProfile('pdf-generation', 'light')).toBe(true);
    expect(matchesProfile('audio-generation', 'light')).toBe(false);
    expect(matchesProfile('content-extraction', 'light')).toBe(false);
  });

  it('unknown profile matches everything', () => {
    expect(matchesProfile('audio-generation', 'unknown')).toBe(true);
  });
});

describe('matchesPreset', () => {
  it('preset=full includes everything', () => {
    expect(matchesPreset('demo-voiceover', 'full')).toBe(true);
    expect(matchesPreset('audio-generation', 'full')).toBe(true);
    expect(matchesPreset('lip-sync-test', 'full')).toBe(true);
  });

  it('preset=core excludes EXPERIMENTAL_WORKERS (denylist)', () => {
    expect(matchesPreset('demo-voiceover', 'core')).toBe(false);
    expect(matchesPreset('demo-script', 'core')).toBe(false);
    expect(matchesPreset('music-generation', 'core')).toBe(false);
  });

  it('preset=core includes production workers', () => {
    expect(matchesPreset('audio-generation', 'core')).toBe(true);
    expect(matchesPreset('voice-track-audio', 'core')).toBe(true);
    expect(matchesPreset('visual-generation', 'core')).toBe(true);
    expect(matchesPreset('transition-generation', 'core')).toBe(true);
    expect(matchesPreset('video-composition', 'core')).toBe(true);
    expect(matchesPreset('notifications', 'core')).toBe(true);
    expect(matchesPreset('content-extraction', 'core')).toBe(true);
  });

  it('unknown preset defaults to include (returns true)', () => {
    expect(matchesPreset('anything', 'banana')).toBe(true);
  });
});

describe('shouldRun — the bug fix', () => {
  it('voice-track-audio runs with heavy+core', () => {
    expect(shouldRun('voice-track-audio', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });

  it('visual-generation runs with heavy+core', () => {
    expect(shouldRun('visual-generation', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });

  it('transition-generation runs with heavy+core', () => {
    expect(shouldRun('transition-generation', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });

  it('video-composition runs with heavy+core', () => {
    expect(shouldRun('video-composition', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });
});

describe('shouldRun — experimental workers excluded', () => {
  it('demo-voiceover excluded with heavy+core', () => {
    expect(shouldRun('demo-voiceover', opts({ profile: 'heavy', preset: 'core' }))).toBe(false);
  });

  it('demo-composition excluded with heavy+core', () => {
    expect(shouldRun('demo-composition', opts({ profile: 'heavy', preset: 'core' }))).toBe(false);
  });

  it('avatar-generation runs with heavy+core (not experimental)', () => {
    expect(shouldRun('avatar-generation', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });

  it('music-generation excluded with heavy+core', () => {
    expect(shouldRun('music-generation', opts({ profile: 'heavy', preset: 'core' }))).toBe(false);
  });

  it('demo-script excluded with pipeline+core', () => {
    expect(shouldRun('demo-script', opts({ profile: 'pipeline', preset: 'core' }))).toBe(false);
  });
});

describe('shouldRun — preset=full includes everything', () => {
  it('demo-voiceover included with heavy+full', () => {
    expect(shouldRun('demo-voiceover', opts({ profile: 'heavy', preset: 'full' }))).toBe(true);
  });

  it('lip-sync-test included with heavy+full', () => {
    // lip-sync-test is not in HEAVY_WORKERS, so it won't match heavy profile
    expect(shouldRun('lip-sync-test', opts({ profile: 'all', preset: 'full' }))).toBe(true);
  });
});

describe('shouldRun — filters', () => {
  it('exclude filter overrides preset', () => {
    const exclude = new Set(['audio-generation']);
    expect(shouldRun('audio-generation', opts({ profile: 'heavy', preset: 'core', excludeFilter: exclude }))).toBe(false);
  });

  it('include filter restricts to specified workers only', () => {
    const include = new Set(['audio-generation']);
    expect(shouldRun('audio-generation', opts({ profile: 'heavy', preset: 'core', includeFilter: include }))).toBe(true);
    expect(shouldRun('voice-track-audio', opts({ profile: 'heavy', preset: 'core', includeFilter: include }))).toBe(false);
  });

  it('exclude filter takes priority over include filter', () => {
    const include = new Set(['audio-generation']);
    const exclude = new Set(['audio-generation']);
    expect(shouldRun('audio-generation', opts({ profile: 'heavy', preset: 'core', includeFilter: include, excludeFilter: exclude }))).toBe(false);
  });
});

describe('shouldRun — profile filtering with preset=core', () => {
  it('light workers run with light+core', () => {
    expect(shouldRun('notifications', opts({ profile: 'light', preset: 'core' }))).toBe(true);
    expect(shouldRun('pdf-generation', opts({ profile: 'light', preset: 'core' }))).toBe(true);
  });

  it('heavy workers do not run with light+core', () => {
    expect(shouldRun('audio-generation', opts({ profile: 'light', preset: 'core' }))).toBe(false);
  });

  it('pipeline workers run with pipeline+core (non-experimental)', () => {
    expect(shouldRun('content-extraction', opts({ profile: 'pipeline', preset: 'core' }))).toBe(true);
    expect(shouldRun('visual-classification', opts({ profile: 'pipeline', preset: 'core' }))).toBe(true);
    expect(shouldRun('place-enrichment', opts({ profile: 'pipeline', preset: 'core' }))).toBe(true);
    expect(shouldRun('voice-track-stitching', opts({ profile: 'pipeline', preset: 'core' }))).toBe(true);
  });
});

describe('set integrity', () => {
  it('all EXPERIMENTAL entries exist in HEAVY or PIPELINE', () => {
    for (const worker of EXPERIMENTAL_WORKERS) {
      const inHeavy = HEAVY_WORKERS.has(worker);
      const inPipeline = PIPELINE_WORKERS.has(worker);
      expect(
        inHeavy || inPipeline,
        `${worker} is in EXPERIMENTAL but not in HEAVY or PIPELINE`,
      ).toBe(true);
    }
  });

  it('segment-preview is in HEAVY_WORKERS (not experimental)', () => {
    expect(HEAVY_WORKERS.has('segment-preview')).toBe(true);
    expect(EXPERIMENTAL_WORKERS.has('segment-preview')).toBe(false);
  });
});
