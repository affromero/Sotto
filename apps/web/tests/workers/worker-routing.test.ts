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
    expect(matchesProfile('audio-stitching', 'heavy')).toBe(true);
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
    expect(matchesPreset('audio-generation', 'full')).toBe(true);
    expect(matchesPreset('some-new-worker', 'full')).toBe(true);
  });

  it('preset=core has no experimental denylist after demo workers were removed', () => {
    expect(EXPERIMENTAL_WORKERS.size).toBe(0);
  });

  it('preset=core includes production workers', () => {
    expect(matchesPreset('audio-generation', 'core')).toBe(true);
    expect(matchesPreset('audio-stitching', 'core')).toBe(true);
    expect(matchesPreset('speaking-grading', 'core')).toBe(true);
    expect(matchesPreset('notifications', 'core')).toBe(true);
    expect(matchesPreset('content-extraction', 'core')).toBe(true);
  });

  it('unknown preset defaults to include (returns true)', () => {
    expect(matchesPreset('anything', 'banana')).toBe(true);
  });
});

describe('shouldRun — the bug fix', () => {
  it('audio-stitching runs with heavy+core', () => {
    expect(shouldRun('audio-stitching', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });

  it('audio-generation runs with heavy+core', () => {
    expect(shouldRun('audio-generation', opts({ profile: 'heavy', preset: 'core' }))).toBe(true);
  });
});

describe('shouldRun — preset=full includes everything', () => {
  it('audio-generation included with heavy+full', () => {
    expect(shouldRun('audio-generation', opts({ profile: 'heavy', preset: 'full' }))).toBe(true);
  });

  it('unknown workers run by default under full (denylist semantics)', () => {
    expect(shouldRun('some-new-worker', opts({ profile: 'all', preset: 'full' }))).toBe(true);
  });
});

describe('shouldRun — filters', () => {
  it('exclude filter overrides preset', () => {
    const exclude = new Set(['audio-generation']);
    expect(
      shouldRun(
        'audio-generation',
        opts({ profile: 'heavy', preset: 'core', excludeFilter: exclude })
      )
    ).toBe(false);
  });

  it('include filter restricts to specified workers only', () => {
    const include = new Set(['audio-generation']);
    expect(
      shouldRun(
        'audio-generation',
        opts({ profile: 'heavy', preset: 'core', includeFilter: include })
      )
    ).toBe(true);
    expect(
      shouldRun(
        'audio-stitching',
        opts({ profile: 'heavy', preset: 'core', includeFilter: include })
      )
    ).toBe(false);
  });

  it('exclude filter takes priority over include filter', () => {
    const include = new Set(['audio-generation']);
    const exclude = new Set(['audio-generation']);
    expect(
      shouldRun(
        'audio-generation',
        opts({ profile: 'heavy', preset: 'core', includeFilter: include, excludeFilter: exclude })
      )
    ).toBe(false);
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
    expect(shouldRun('content-extraction', opts({ profile: 'pipeline', preset: 'core' }))).toBe(
      true
    );
    expect(shouldRun('script-generation', opts({ profile: 'pipeline', preset: 'core' }))).toBe(
      true
    );
    expect(shouldRun('speaking-grading', opts({ profile: 'pipeline', preset: 'core' }))).toBe(true);
  });
});

describe('set integrity', () => {
  it('all EXPERIMENTAL entries exist in HEAVY or PIPELINE', () => {
    for (const worker of EXPERIMENTAL_WORKERS) {
      const inHeavy = HEAVY_WORKERS.has(worker);
      const inPipeline = PIPELINE_WORKERS.has(worker);
      expect(
        inHeavy || inPipeline,
        `${worker} is in EXPERIMENTAL but not in HEAVY or PIPELINE`
      ).toBe(true);
    }
  });

  it('audio-stitching is in HEAVY_WORKERS (not experimental)', () => {
    expect(HEAVY_WORKERS.has('audio-stitching')).toBe(true);
    expect(EXPERIMENTAL_WORKERS.has('audio-stitching')).toBe(false);
  });
});
