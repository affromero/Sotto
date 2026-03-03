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
    completedVoiceTrackCount: 0,
    tagCount: 0,
    answeredInteractionCount: 0,
    ratingCount: 0,
    playbackSessionCount: 0,
    hasMLFeatures: false,
    apiCostLogCount: 0,
    segmentVoiceMapCount: 0,
    ...overrides,
  };
}

describe('computeCompletenessChecklist', () => {
  it('returns 0/15 when all dimensions are missing', () => {
    const result = computeCompletenessChecklist(makeInput());

    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(15);
    expect(result.dimensions).toHaveLength(15);
    expect(result.dimensions.every((d) => !d.present)).toBe(true);
  });

  it('returns 15/15 when all dimensions are present', () => {
    const result = computeCompletenessChecklist(makeInput({
      hasScript: true,
      hasAudio: true,
      segmentCount: 5,
      segmentsWithAudio: 5,
      referenceCount: 3,
      verifiedReferenceCount: 2,
      discoveryMessageCount: 4,
      voiceAssignmentCount: 2,
      completedVoiceTrackCount: 1,
      tagCount: 3,
      answeredInteractionCount: 1,
      ratingCount: 2,
      playbackSessionCount: 5,
      hasMLFeatures: true,
      apiCostLogCount: 10,
      segmentVoiceMapCount: 5,
    }));

    expect(result.score).toBe(15);
    expect(result.maxScore).toBe(15);
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
    expect(result.maxScore).toBe(15);

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

  it('includes voiceTracks dimension', () => {
    const result = computeCompletenessChecklist(makeInput({
      completedVoiceTrackCount: 1,
    }));

    const dim = result.dimensions.find((d) => d.key === 'voiceTracks');
    expect(dim).toBeDefined();
    expect(dim?.label).toBe('Voice Tracks');
    expect(dim?.present).toBe(true);
  });

  it('includes segmentVoiceMap dimension', () => {
    const result = computeCompletenessChecklist(makeInput({
      segmentVoiceMapCount: 3,
    }));

    const dim = result.dimensions.find((d) => d.key === 'segmentVoiceMap');
    expect(dim).toBeDefined();
    expect(dim?.label).toBe('Segment Voice Map');
    expect(dim?.present).toBe(true);
  });

  it('has correct labels for all 15 dimensions', () => {
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
      'voiceTracks',
      'tags',
      'qaInteractions',
      'ratings',
      'playbackData',
      'mlFeatures',
      'apiCostLogs',
      'segmentVoiceMap',
    ]);
  });

  it('boundary: single item counts as present', () => {
    const result = computeCompletenessChecklist(makeInput({
      referenceCount: 1,
      verifiedReferenceCount: 1,
      discoveryMessageCount: 1,
      voiceAssignmentCount: 1,
      completedVoiceTrackCount: 1,
      tagCount: 1,
      answeredInteractionCount: 1,
      ratingCount: 1,
      playbackSessionCount: 1,
      apiCostLogCount: 1,
      segmentVoiceMapCount: 1,
    }));

    // Script, Audio, Segments, ML Features are still false
    expect(result.score).toBe(11);
  });
});
