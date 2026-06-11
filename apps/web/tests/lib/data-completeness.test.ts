import { describe, it, expect } from 'vitest';
import { computeCompletenessChecklist, type CompletenessInput } from '@/lib/data-completeness';

function makeInput(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    hasScript: false,
    hasAudio: false,
    segmentCount: 0,
    segmentsWithAudio: 0,
    referenceCount: 0,
    verifiedReferenceCount: 0,
    discoveryMessageCount: 0,
    voiceAssignmentCount: 0,
    tagCount: 0,
    answeredInteractionCount: 0,
    playbackSessionCount: 0,
    hasMLFeatures: false,
    apiCostLogCount: 0,
    ...overrides,
  };
}

describe('computeCompletenessChecklist', () => {
  it('returns 0/12 when all dimensions are missing', () => {
    const result = computeCompletenessChecklist(makeInput());

    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(12);
    expect(result.dimensions).toHaveLength(12);
    expect(result.dimensions.every((d) => !d.present)).toBe(true);
  });

  it('returns 12/12 when all dimensions are present', () => {
    const result = computeCompletenessChecklist(makeInput({
      hasScript: true,
      hasAudio: true,
      segmentCount: 5,
      segmentsWithAudio: 5,
      referenceCount: 3,
      verifiedReferenceCount: 2,
      discoveryMessageCount: 4,
      voiceAssignmentCount: 2,
      tagCount: 3,
      answeredInteractionCount: 1,
      playbackSessionCount: 5,
      hasMLFeatures: true,
      apiCostLogCount: 10,
    }));

    expect(result.score).toBe(12);
    expect(result.maxScore).toBe(12);
    expect(result.dimensions.every((d) => d.present)).toBe(true);
  });

  it('returns correct partial score', () => {
    const result = computeCompletenessChecklist(makeInput({
      hasScript: true,
      hasAudio: true,
      segmentCount: 3,
      segmentsWithAudio: 3,
      referenceCount: 2,
      verifiedReferenceCount: 0,
      discoveryMessageCount: 5,
    }));

    expect(result.score).toBe(5);
    expect(result.maxScore).toBe(12);

    const presentKeys = result.dimensions.filter((d) => d.present).map((d) => d.key);
    expect(presentKeys).toContain('script');
    expect(presentKeys).toContain('audio');
    expect(presentKeys).toContain('segments');
    expect(presentKeys).toContain('references');
    expect(presentKeys).toContain('discoveryChat');
    expect(presentKeys).not.toContain('verifiedReferences');
  });

  it('marks segments as incomplete when some lack audio', () => {
    const result = computeCompletenessChecklist(makeInput({
      segmentCount: 5,
      segmentsWithAudio: 3,
    }));

    const segDim = result.dimensions.find((d) => d.key === 'segments');
    expect(segDim?.present).toBe(false);
  });

  it('marks segments as complete when all have audio', () => {
    const result = computeCompletenessChecklist(makeInput({
      segmentCount: 5,
      segmentsWithAudio: 5,
    }));

    const segDim = result.dimensions.find((d) => d.key === 'segments');
    expect(segDim?.present).toBe(true);
  });

  it('marks segments as incomplete when count is 0', () => {
    const result = computeCompletenessChecklist(makeInput({
      segmentCount: 0,
      segmentsWithAudio: 0,
    }));

    const segDim = result.dimensions.find((d) => d.key === 'segments');
    expect(segDim?.present).toBe(false);
  });

  it('has correct labels for all 12 dimensions', () => {
    const result = computeCompletenessChecklist(makeInput());
    const keys = result.dimensions.map((d) => d.key);

    expect(keys).toEqual([
      'script',
      'audio',
      'segments',
      'references',
      'verifiedReferences',
      'discoveryChat',
      'voiceAssignments',
      'tags',
      'qaInteractions',
      'playbackData',
      'mlFeatures',
      'apiCostLogs',
    ]);
  });

  it('boundary: single item counts as present', () => {
    const result = computeCompletenessChecklist(makeInput({
      referenceCount: 1,
      verifiedReferenceCount: 1,
      discoveryMessageCount: 1,
      voiceAssignmentCount: 1,
      tagCount: 1,
      answeredInteractionCount: 1,
      playbackSessionCount: 1,
      apiCostLogCount: 1,
    }));

    // Script, Audio, Segments, ML Features are still false
    expect(result.score).toBe(8);
  });

  it('each dimension is independently togglable', () => {
    const dimensionInputMap: Record<string, Partial<CompletenessInput>> = {
      script: { hasScript: true },
      audio: { hasAudio: true },
      segments: { segmentCount: 1, segmentsWithAudio: 1 },
      references: { referenceCount: 1 },
      verifiedReferences: { verifiedReferenceCount: 1 },
      discoveryChat: { discoveryMessageCount: 1 },
      voiceAssignments: { voiceAssignmentCount: 1 },
      tags: { tagCount: 1 },
      qaInteractions: { answeredInteractionCount: 1 },
      playbackData: { playbackSessionCount: 1 },
      mlFeatures: { hasMLFeatures: true },
      apiCostLogs: { apiCostLogCount: 1 },
    };

    for (const [key, overrides] of Object.entries(dimensionInputMap)) {
      const result = computeCompletenessChecklist(makeInput(overrides));
      const dim = result.dimensions.find((d) => d.key === key);
      expect(dim?.present, `${key} should be present when its input is set`).toBe(true);
      expect(result.score, `score should be 1 when only ${key} is set`).toBe(1);
    }
  });

  it('segments require both count > 0 AND all having audio', () => {
    // Has segments but none with audio
    const noAudio = computeCompletenessChecklist(makeInput({
      segmentCount: 10,
      segmentsWithAudio: 0,
    }));
    expect(noAudio.dimensions.find((d) => d.key === 'segments')?.present).toBe(false);

    // Has segments with partial audio
    const partial = computeCompletenessChecklist(makeInput({
      segmentCount: 10,
      segmentsWithAudio: 9,
    }));
    expect(partial.dimensions.find((d) => d.key === 'segments')?.present).toBe(false);

    // All segments have audio
    const all = computeCompletenessChecklist(makeInput({
      segmentCount: 10,
      segmentsWithAudio: 10,
    }));
    expect(all.dimensions.find((d) => d.key === 'segments')?.present).toBe(true);
  });

  it('score equals count of present dimensions', () => {
    // Set exactly 7 dimensions present
    const result = computeCompletenessChecklist(makeInput({
      hasScript: true,
      hasAudio: true,
      referenceCount: 3,
      verifiedReferenceCount: 1,
      tagCount: 2,
      playbackSessionCount: 2,
      hasMLFeatures: true,
    }));

    const presentCount = result.dimensions.filter((d) => d.present).length;
    expect(result.score).toBe(presentCount);
    expect(result.score).toBe(7);
  });

  it('dimension labels are all non-empty strings', () => {
    const result = computeCompletenessChecklist(makeInput());
    for (const dim of result.dimensions) {
      expect(dim.label.length).toBeGreaterThan(0);
      expect(dim.key.length).toBeGreaterThan(0);
    }
  });

  it('maxScore is always 12 regardless of input', () => {
    const empty = computeCompletenessChecklist(makeInput());
    const full = computeCompletenessChecklist(makeInput({
      hasScript: true,
      hasAudio: true,
      segmentCount: 5,
      segmentsWithAudio: 5,
      referenceCount: 1,
      verifiedReferenceCount: 1,
      discoveryMessageCount: 1,
      voiceAssignmentCount: 1,
      tagCount: 1,
      answeredInteractionCount: 1,
      playbackSessionCount: 1,
      hasMLFeatures: true,
      apiCostLogCount: 1,
    }));

    expect(empty.maxScore).toBe(12);
    expect(full.maxScore).toBe(12);
  });

  it('no duplicate dimension keys', () => {
    const result = computeCompletenessChecklist(makeInput());
    const keys = result.dimensions.map((d) => d.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
