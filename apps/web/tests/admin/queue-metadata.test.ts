import { describe, it, expect } from 'vitest';
import { ALL_QUEUE_NAMES } from '@/lib/queue';
import { QUEUE_METADATA, PIPELINE_STAGE_ORDER } from '@/app/(admin)/admin/queues/queue-metadata';

describe('queue-metadata', () => {
  it('identifies complete source analysis and private placement preparation', () => {
    expect(QUEUE_METADATA['material-analysis']).toMatchObject({ stage: 'Content Pipeline' });
    expect(QUEUE_METADATA['material-analysis'].description).toMatch(/every retained text chunk/);
    expect(QUEUE_METADATA['placement-generation'].description).toMatch(
      /private placement.*exact source analyses/
    );
  });
  it('explains complete page extraction and unresolved visual content', () => {
    expect(QUEUE_METADATA['material-extraction'].stage).toBe('Content Pipeline');
    expect(QUEUE_METADATA['material-extraction'].description).toMatch(
      /complete page text.*visual coverage gaps/
    );
  });
  it('describes optional compression as a complete-content verification step', () => {
    expect(QUEUE_METADATA['material-optimization']).toMatchObject({ stage: 'Content Pipeline' });
    expect(QUEUE_METADATA['material-optimization'].description).toMatch(
      /complete PDF content.*lossless compression/
    );
  });
  it('explains original material verification in the content pipeline', () => {
    expect(QUEUE_METADATA['material-finalization'].stage).toBe('Content Pipeline');
    expect(QUEUE_METADATA['material-finalization'].description).toMatch(
      /complete original document/
    );
  });
  it('distinguishes reviewed vocabulary indexing from reusable local pronunciation', () => {
    expect(QUEUE_METADATA['vocabulary-index'].stage).toBe('Content Pipeline');
    expect(QUEUE_METADATA['vocabulary-audio'].description).toMatch(/reusable local pronunciation/);
  });
  it('identifies image interpretation as review before submission', () => {
    expect(QUEUE_METADATA['pencil-homework'].stage).toBe('Content Pipeline');
    expect(QUEUE_METADATA['pencil-homework'].description).toMatch(
      /review before class submission/i
    );
  });
  it('places saved practice preparation in the content pipeline', () => {
    expect(QUEUE_METADATA['practice-preparation']).toMatchObject({ stage: 'Content Pipeline' });
  });
  it('explains durable class preparation in the content pipeline', () => {
    expect(QUEUE_METADATA['class-preparation'].stage).toBe('Content Pipeline');
    expect(QUEUE_METADATA['class-preparation'].description).toMatch(/durable.*requests/i);
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
