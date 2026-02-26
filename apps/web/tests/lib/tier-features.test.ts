import { describe, it, expect } from 'vitest';
import { getTierFeatures, getJobPriority, isModelAllowedForUser, type TierFeatures } from '@/lib/tier-features';

describe('getTierFeatures', () => {
  describe('FREE + no BYOK', () => {
    const features = getTierFeatures('FREE', false);

    it('caps duration at 5 minutes', () => {
      expect(features.maxDurationMinutes).toBe(5);
    });

    it('limits to 2 speakers', () => {
      expect(features.maxSpeakers).toBe(2);
    });

    it('auto-approves scripts', () => {
      expect(features.autoApproveScript).toBe(true);
    });

    it('enables web search', () => {
      expect(features.webSearchEnabled).toBe(true);
    });

    it('limits QA interactions to 3', () => {
      expect(features.maxQaInteractions).toBe(3);
    });

    it('blocks private podcasts', () => {
      expect(features.privateAllowed).toBe(false);
    });

    it('blocks downloads', () => {
      expect(features.downloadAllowed).toBe(false);
    });

    it('gives no priority queue', () => {
      expect(features.priorityQueue).toBe(false);
    });

    it('disables analytics', () => {
      expect(features.analyticsEnabled).toBe(false);
    });

    it('disables voice tracks', () => {
      expect(features.voiceTracksEnabled).toBe(false);
    });

    it('allows zero voice tracks', () => {
      expect(features.maxVoiceTracks).toBe(0);
    });

    it('disables voice cloning', () => {
      expect(features.voiceCloningEnabled).toBe(false);
    });
  });

  describe('FREE + BYOK', () => {
    const features = getTierFeatures('FREE', true);

    it('unlocks unlimited duration', () => {
      expect(features.maxDurationMinutes).toBe(Infinity);
    });

    it('keeps free limits for everything else', () => {
      expect(features.maxSpeakers).toBe(2);
      expect(features.autoApproveScript).toBe(true);
      expect(features.webSearchEnabled).toBe(true);
      expect(features.maxQaInteractions).toBe(3);
      expect(features.privateAllowed).toBe(false);
      expect(features.downloadAllowed).toBe(false);
      expect(features.priorityQueue).toBe(false);
      expect(features.analyticsEnabled).toBe(false);
      expect(features.voiceTracksEnabled).toBe(false);
      expect(features.maxVoiceTracks).toBe(0);
      expect(features.voiceCloningEnabled).toBe(false);
    });
  });

  describe('PRO + no BYOK', () => {
    const features = getTierFeatures('PRO', false);

    it('caps duration at 30 minutes', () => {
      expect(features.maxDurationMinutes).toBe(30);
    });

    it('allows 4 speakers', () => {
      expect(features.maxSpeakers).toBe(4);
    });

    it('requires manual script approval', () => {
      expect(features.autoApproveScript).toBe(false);
    });

    it('enables web search', () => {
      expect(features.webSearchEnabled).toBe(true);
    });

    it('gives unlimited QA interactions', () => {
      expect(features.maxQaInteractions).toBe(Infinity);
    });

    it('allows private podcasts', () => {
      expect(features.privateAllowed).toBe(true);
    });

    it('allows downloads', () => {
      expect(features.downloadAllowed).toBe(true);
    });

    it('gives priority queue', () => {
      expect(features.priorityQueue).toBe(true);
    });

    it('enables analytics', () => {
      expect(features.analyticsEnabled).toBe(true);
    });

    it('enables voice tracks', () => {
      expect(features.voiceTracksEnabled).toBe(true);
    });

    it('allows 3 voice tracks', () => {
      expect(features.maxVoiceTracks).toBe(3);
    });

    it('enables voice cloning', () => {
      expect(features.voiceCloningEnabled).toBe(true);
    });
  });

  describe('PRO + BYOK', () => {
    const features = getTierFeatures('PRO', true);

    it('unlocks unlimited duration', () => {
      expect(features.maxDurationMinutes).toBe(Infinity);
    });

    it('unlocks unlimited voice tracks', () => {
      expect(features.maxVoiceTracks).toBe(Infinity);
    });

    it('keeps all other pro features', () => {
      expect(features.maxSpeakers).toBe(4);
      expect(features.autoApproveScript).toBe(false);
      expect(features.webSearchEnabled).toBe(true);
      expect(features.maxQaInteractions).toBe(Infinity);
      expect(features.privateAllowed).toBe(true);
      expect(features.downloadAllowed).toBe(true);
      expect(features.priorityQueue).toBe(true);
      expect(features.analyticsEnabled).toBe(true);
      expect(features.voiceTracksEnabled).toBe(true);
      expect(features.voiceCloningEnabled).toBe(true);
    });
  });

  describe('privileged roles get PRO_BYOK regardless of plan', () => {
    const expected: TierFeatures = {
      maxDurationMinutes: Infinity,
      maxSpeakers: 4,
      autoApproveScript: false,
      webSearchEnabled: true,
      maxQaInteractions: Infinity,
      privateAllowed: true,
      downloadAllowed: true,
      priorityQueue: true,
      analyticsEnabled: true,
      voiceTracksEnabled: true,
      maxVoiceTracks: Infinity,
      voiceCloningEnabled: true,
    };

    it('ADMIN on FREE without BYOK gets full access', () => {
      expect(getTierFeatures('FREE', false, 'ADMIN')).toEqual(expected);
    });

    it('ADMIN on FREE with BYOK gets full access', () => {
      expect(getTierFeatures('FREE', true, 'ADMIN')).toEqual(expected);
    });

    it('ADMIN on PRO without BYOK gets full access', () => {
      expect(getTierFeatures('PRO', false, 'ADMIN')).toEqual(expected);
    });

    it('SYSTEM role gets full access', () => {
      expect(getTierFeatures('FREE', false, 'SYSTEM')).toEqual(expected);
    });

    it('regular USER role does not get privileged access', () => {
      const features = getTierFeatures('FREE', false, 'USER');
      expect(features.privateAllowed).toBe(false);
      expect(features.maxDurationMinutes).toBe(5);
    });

    it('undefined role does not get privileged access', () => {
      const features = getTierFeatures('FREE', false);
      expect(features.privateAllowed).toBe(false);
    });
  });
});

describe('isModelAllowedForUser', () => {
  it('blocks free non-BYOK users from PRO models', () => {
    expect(isModelAllowedForUser('PRO', 'FREE', false)).toBe(false);
  });

  it('allows free non-BYOK users to use FREE models', () => {
    expect(isModelAllowedForUser('FREE', 'FREE', false)).toBe(true);
  });

  it('allows free BYOK users to use PRO models', () => {
    expect(isModelAllowedForUser('PRO', 'FREE', true)).toBe(true);
  });

  it('allows PRO users to use PRO models', () => {
    expect(isModelAllowedForUser('PRO', 'PRO', false)).toBe(true);
  });

  it('allows ADMIN to use any model regardless of plan', () => {
    expect(isModelAllowedForUser('PRO', 'FREE', false, 'ADMIN')).toBe(true);
  });

  it('allows SYSTEM role to use any model', () => {
    expect(isModelAllowedForUser('PRO', 'FREE', false, 'SYSTEM')).toBe(true);
  });

  it('regular USER role on free plan is blocked from PRO models', () => {
    expect(isModelAllowedForUser('PRO', 'FREE', false, 'USER')).toBe(false);
  });
});

describe('getJobPriority', () => {
  it('FREE without BYOK gets low priority', () => {
    expect(getJobPriority('FREE', false)).toBe(10);
  });

  it('FREE with BYOK still gets low priority', () => {
    expect(getJobPriority('FREE', true)).toBe(10);
  });

  it('PRO without BYOK gets high priority', () => {
    expect(getJobPriority('PRO', false)).toBe(1);
  });

  it('PRO with BYOK gets high priority', () => {
    expect(getJobPriority('PRO', true)).toBe(1);
  });

  it('ADMIN gets high priority regardless of plan', () => {
    expect(getJobPriority('FREE', false, 'ADMIN')).toBe(1);
  });

  it('SYSTEM gets high priority regardless of plan', () => {
    expect(getJobPriority('FREE', false, 'SYSTEM')).toBe(1);
  });
});
