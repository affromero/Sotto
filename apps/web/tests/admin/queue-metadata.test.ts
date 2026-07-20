import { describe, it, expect } from 'vitest';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { QUEUE_METADATA, PIPELINE_STAGE_ORDER } from '@/app/(admin)/admin/queues/queue-metadata';

describe('queue-metadata', () => {
  it('has metadata for every queue in ALL_QUEUE_NAMES', () => {
    for (const name of ALL_QUEUE_NAMES) {
      expect(QUEUE_METADATA[name]).toBeDefined();
    }
  });

  it('does not have metadata for queues not in ALL_QUEUE_NAMES', () => {
    const knownNames = new Set<string>(ALL_QUEUE_NAMES);
    for (const name of Object.keys(QUEUE_METADATA)) {
      expect(knownNames.has(name)).toBe(true);
    }
  });

  it('covers exactly the same queues as ALL_QUEUE_NAMES', () => {
    const metadataNames = Object.keys(QUEUE_METADATA).sort();
    const allNames = [...ALL_QUEUE_NAMES].sort();
    expect(metadataNames).toEqual(allNames);
  });

  it('every queue has a non-empty description', () => {
    for (const [name, meta] of Object.entries(QUEUE_METADATA)) {
      expect(meta.description.length, `${name} description is empty`).toBeGreaterThan(0);
    }
  });

  it('every queue stage appears in PIPELINE_STAGE_ORDER', () => {
    const stageSet = new Set(PIPELINE_STAGE_ORDER);
    for (const [name, meta] of Object.entries(QUEUE_METADATA)) {
      expect(
        stageSet.has(meta.stage),
        `${name} stage "${meta.stage}" not in PIPELINE_STAGE_ORDER`
      ).toBe(true);
    }
  });

  it('every stage in PIPELINE_STAGE_ORDER has at least one queue', () => {
    const usedStages = new Set(Object.values(QUEUE_METADATA).map((m) => m.stage));
    for (const stage of PIPELINE_STAGE_ORDER) {
      expect(usedStages.has(stage), `stage "${stage}" has no queues`).toBe(true);
    }
  });

  it('PIPELINE_STAGE_ORDER has no duplicates', () => {
    const unique = new Set(PIPELINE_STAGE_ORDER);
    expect(unique.size).toBe(PIPELINE_STAGE_ORDER.length);
  });
});
