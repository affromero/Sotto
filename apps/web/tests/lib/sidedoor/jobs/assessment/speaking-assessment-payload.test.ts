import { describe, expect, it } from 'vitest';
import { assessmentSpeakingGradingPayloadSchema } from '@/lib/sidedoor/jobs/stitch/speaking-grading-work';

const operationId = '3a3dfaed-b222-489a-9e13-5d050d843007';
const recordingId = 'a9216d44-84ff-48b0-8a72-3333803434b3';
const parent = {
  kind: 'assessment',
  id: 'section',
  parentId: 'assessment',
  courseId: 'course',
  assessment: {
    classId: 'class',
    userId: 'owner',
    classAttempt: 1,
    currentClassAttempt: 1,
    assessmentAttempt: 1,
    status: 'READY',
    sealedAt: 10,
    reviewedMaterialDigest: 'a'.repeat(64),
  },
};

function fixture() {
  return {
    recordingId,
    recordingCreatedAt: 20,
    storage: {
      consumer: `recording:${recordingId}:audio`,
      reference: '/audio',
      assetId: 'b'.repeat(64),
      backendId: 'c'.repeat(64),
      binding: 'd'.repeat(64),
      key: 'audio.webm',
    },
    ownership: {
      instanceId: 'instance',
      reference: '/audio',
      scopes: [
        { subjectId: 'instance:instance', generation: 0 },
        { subjectId: 'profile:owner', generation: 1 },
        { subjectId: 'course:course', generation: 2 },
        { subjectId: 'class:class', generation: 3 },
      ],
      associations: {
        recordingId,
        createdAt: 20,
        userId: 'owner',
        prompt: { promptId: 'prompt', createdAt: 5, parents: [parent] },
        parents: [parent],
      },
    },
    grant: {
      id: operationId,
      revision: '2f9b77cc-dde6-4f57-bad0-2f9634dbe2ee',
      fingerprint: 'e'.repeat(64),
    },
    assessment: {
      version: 1,
      operationId,
      recordingId,
      assessmentId: 'assessment',
      classId: 'class',
      courseId: 'course',
      userId: 'owner',
      classAttempt: 1,
      assessmentAttempt: 1,
      sectionId: 'section',
      promptId: 'prompt',
      materialDigest: 'a'.repeat(64),
      taskDigest: 'f'.repeat(64),
      speakingPolicy: 'READ_ALOUD_TRANSCRIPT_V1',
      audio: { sha256: '1'.repeat(64), bytes: 3, contentType: 'audio/webm' },
      selection: {
        providerId: 'speech',
        model: 'model',
        baseUrl: null,
        credentialFingerprint: null,
      },
      gradingSelection: {
        provider: 'ai',
        model: 'model',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
    },
  };
}

describe('assessment speaking job binding', () => {
  it('accepts one reviewed assessment recording', () => {
    const input = fixture();
    expect(assessmentSpeakingGradingPayloadSchema.parse(input)).toEqual(input);
  });

  it('rejects jobs whose recording or reviewed assessment identity changed', () => {
    const changes: Array<(value: ReturnType<typeof fixture>) => void> = [
      (value) => {
        value.assessment.userId = 'other';
      },
      (value) => {
        value.assessment.operationId = recordingId;
      },
      (value) => {
        value.assessment.materialDigest = '9'.repeat(64);
      },
      (value) => {
        value.assessment.classAttempt = 2;
      },
      (value) => {
        value.assessment.sectionId = 'other';
      },
      (value) => {
        value.assessment.speakingPolicy = 'unsupported';
      },
      (value) => {
        value.ownership.associations.prompt.promptId = 'other';
      },
      (value) => {
        value.storage.consumer = 'recording:other:audio';
      },
      (value) => {
        value.ownership.scopes = value.ownership.scopes.filter(
          (scope) => !scope.subjectId.startsWith('class:')
        );
      },
      (value) => {
        value.ownership.associations.parents[0] = {
          ...parent,
          assessment: { ...parent.assessment, status: 'COMMITTED' },
        };
      },
    ];
    for (const change of changes) {
      const input = structuredClone(fixture());
      change(input);
      expect(assessmentSpeakingGradingPayloadSchema.safeParse(input).success).toBe(false);
    }
  });
});
