import { describe, expect, it } from 'vitest';
import {
  assessmentListeningAudioIdentity,
  assessmentSpeakingReferenceIdentity,
} from '@/lib/learning/classes/material/assessment-audio';
import { learningScriptHash } from '@/lib/learning/script-hash';

const reference = (consumer: string) => ({
  consumer,
  reference: '/audio',
  assetId: 'a'.repeat(64),
  backendId: 'b'.repeat(64),
  binding: 'c'.repeat(64),
  key: 'owned/audio',
});

describe('assessment audio identity', () => {
  it('binds listening to the exact learner, canonical script and audio content', () => {
    const turns = [{ speaker: 'HOST', text: 'Привет', direction: 'calm' }];
    const identity = {
      schemaVersion: 1,
      episodeId: 'episode',
      userId: 'learner',
      scriptSha256: learningScriptHash(turns),
      contentSha256: 'd'.repeat(64),
      contentBytes: 100,
      audioGenerationKey: 'generation',
      version: 1,
      reference: reference('episode:episode:audio'),
    };
    const expected = { episodeId: 'episode', userId: 'learner', turns };
    const hash = assessmentListeningAudioIdentity(identity, expected);
    expect(
      assessmentListeningAudioIdentity(
        { ...identity, reference: { ...identity.reference, reference: '/renewed' } },
        expected
      )
    ).toBe(hash);
    expect(
      assessmentListeningAudioIdentity({ ...identity, contentSha256: 'e'.repeat(64) }, expected)
    ).not.toBe(hash);
    expect(() =>
      assessmentListeningAudioIdentity(identity, { ...expected, userId: 'other' })
    ).toThrow(/owned script/);
    expect(() =>
      assessmentListeningAudioIdentity(identity, {
        ...expected,
        turns: [{ speaker: 'HOST', text: 'Пока' }],
      })
    ).toThrow(/owned script/);
    expect(() =>
      assessmentListeningAudioIdentity(
        { ...identity, reference: reference('episode:other:audio') },
        expected
      )
    ).toThrow();
  });

  it('binds speaking reference bytes and storage attribution to the assessment prompt', () => {
    const identity = {
      version: 1,
      assessmentId: 'assessment',
      promptId: 'prompt',
      userId: 'learner',
      contentSha256: 'd'.repeat(64),
      contentBytes: 100,
      reference: reference('speaking-prompt:prompt:reference'),
    };
    const expected = { assessmentId: 'assessment', promptId: 'prompt', userId: 'learner' };
    const hash = assessmentSpeakingReferenceIdentity(identity, expected);
    expect(
      assessmentSpeakingReferenceIdentity(
        { ...identity, reference: { ...identity.reference, reference: '/renewed' } },
        expected
      )
    ).toBe(hash);
    expect(
      assessmentSpeakingReferenceIdentity(
        { ...identity, reference: { ...identity.reference, binding: 'e'.repeat(64) } },
        expected
      )
    ).not.toBe(hash);
    expect(() =>
      assessmentSpeakingReferenceIdentity(identity, { ...expected, assessmentId: 'other' })
    ).toThrow(/owned prompt/);
    expect(() =>
      assessmentSpeakingReferenceIdentity(
        { ...identity, reference: reference('speaking-prompt:other:reference') },
        expected
      )
    ).toThrow(/owned prompt/);
  });

  it('binds new speaking references to the dispatched synthesis and its settled count', () => {
    const identity = {
      version: 1,
      assessmentId: 'assessment',
      promptId: 'prompt',
      userId: 'learner',
      contentSha256: 'd'.repeat(64),
      contentBytes: 100,
      reference: reference('speaking-prompt:prompt:reference'),
      provenance: {
        operationId: '10000000-0000-4000-8000-000000000001',
        fingerprint: 'e'.repeat(64),
        provider: 'local',
        model: 'fixture',
        voiceId: 'voice',
        speechFingerprint: 'f'.repeat(64),
        inputDigest: '1'.repeat(64),
        dispatches: 1,
      },
    };
    const expected = { assessmentId: 'assessment', promptId: 'prompt', userId: 'learner' };
    const hash = assessmentSpeakingReferenceIdentity(identity, expected);
    expect(
      assessmentSpeakingReferenceIdentity(
        { ...identity, provenance: { ...identity.provenance, voiceId: 'other' } },
        expected
      )
    ).not.toBe(hash);
    expect(() =>
      assessmentSpeakingReferenceIdentity(
        { ...identity, provenance: { ...identity.provenance, dispatches: 0 } },
        expected
      )
    ).toThrow();
  });
});
