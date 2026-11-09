// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import {
  admitAssessmentFence,
  assertAssessmentFenceSource,
  assessmentFenceStore,
  assessmentRequestRevision,
  recordAssessmentFence,
  type AssessmentFence,
} from '@/lib/learning/classes/lifecycle/assessment-fence';
import { READ_ALOUD_ASSESSMENT_POLICY } from '@/lib/learning/classes/speaking/assessment-speaking-policy';

describe('assessment operation fence', () => {
  let database: DatabaseSync;
  const fixture = (): AssessmentFence => {
    const id = randomUUID();
    const instanceId = randomUUID();
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: null,
    });
    return {
      id,
      assessmentId: 'assessment',
      classId: 'class',
      courseId: 'course',
      userId: 'learner',
      classAttempt: 1,
      assessmentAttempt: 1,
      ownership: {
        instanceId,
        userId: 'learner',
        scopes: [
          { subjectId: `instance:${instanceId}`, generation: 0 },
          { subjectId: 'class:class', generation: 1 },
          { subjectId: 'course:course', generation: 1 },
          { subjectId: 'profile:learner', generation: 1 },
        ],
      },
      formativeRevision: 'a'.repeat(64),
      teachingReceipt: { kind: 'BASE', receiptId: 'receipt' },
      requirements,
      thresholds: { GRAMMAR: 0.7, READING: 0.7, WRITING: 0.7 },
      selection: {
        provider: 'provider',
        model: 'model',
        credentialFingerprint: null,
        moderationCredentialFingerprint: null,
      },
      cliBinding: null,
      grant: { id, revision: randomUUID(), fingerprint: 'b'.repeat(64) },
      status: 'QUEUED',
    };
  };
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(
      'CREATE TABLE SidedoorState (id TEXT PRIMARY KEY, revision TEXT NOT NULL, state TEXT NOT NULL)'
    );
  });
  afterEach(() => database.close());
  const backend = () =>
    sqlStateBackend(
      { query: async (sql, values) => database.prepare(sql).all(...(values as SQLInputValue[])) },
      'sqlite',
      'assessment-class'
    );

  it('binds a preparation revision to the assessment attempt', () => {
    const first = fixture();
    expect(assessmentRequestRevision(first)).not.toBe(
      assessmentRequestRevision({ ...first, assessmentAttempt: 2 })
    );
    expect(assessmentRequestRevision(first)).toBe(assessmentRequestRevision({ ...first }));
  });

  it('retains the original operation for an exact retry after restart', async () => {
    const first = fixture();
    await recordAssessmentFence(backend(), first);
    const stored = (await assessmentFenceStore(backend()).read()).current;
    const newId = randomUUID();
    const retry = {
      ...first,
      id: newId,
      assessmentId: 'new-assessment',
      grant: { ...first.grant, id: newId },
    };
    expect(admitAssessmentFence(stored, retry)).toEqual(first);
  });

  it('preserves the first operation when teaching or provider selection changes', async () => {
    const first = fixture();
    await recordAssessmentFence(backend(), first);
    await expect(
      recordAssessmentFence(backend(), {
        ...first,
        teachingReceipt: { ...first.teachingReceipt, receiptId: 'new' },
      })
    ).rejects.toThrow(/already active/);
    await expect(
      recordAssessmentFence(backend(), {
        ...first,
        selection: { ...first.selection, model: 'different' },
      })
    ).rejects.toThrow(/already active/);
    expect((await assessmentFenceStore(backend()).read()).current).toEqual(first);
  });

  it('does not replay assessment work across material versions', () => {
    const legacy = fixture();
    const current = { ...legacy, materialVersion: 2 as const };
    expect(() => admitAssessmentFence(legacy, current)).toThrow(/already active/);
    expect(() => admitAssessmentFence(current, legacy)).toThrow(/already active/);
    expect(admitAssessmentFence(current, current)).toEqual(current);
    expect(admitAssessmentFence(null, legacy)).not.toHaveProperty('materialVersion');
  });

  it('does not replay a legacy assessment under a different speaking policy', () => {
    const legacy = fixture();
    legacy.requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'es',
      targetLang: 'ru',
      level: 'A1',
      ttsProvider: null,
      sttProvider: 'configured',
    });
    legacy.thresholds.SPEAKING = 0.7;
    const current: AssessmentFence = { ...legacy, speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY };
    expect(() => admitAssessmentFence(legacy, current)).toThrow(/already active/);
    expect(() => admitAssessmentFence(current, legacy)).toThrow(/already active/);
    expect(admitAssessmentFence(current, current)).toEqual(current);
  });

  it.each(['UNRESOLVED', 'COMPLETED', 'FAILED'] as const)(
    'does not replace %s work without retirement proof',
    (status) => {
      const first = fixture();
      expect(() => admitAssessmentFence({ ...first, status }, first)).toThrow(/already active/);
    }
  );

  it('rejects mismatched ownership or incomplete thresholds', () => {
    const first = fixture();
    expect(() => admitAssessmentFence(null, { ...first, userId: 'other' })).toThrow();
    expect(() => admitAssessmentFence(null, { ...first, thresholds: { GRAMMAR: 0.7 } })).toThrow();
  });

  it('pins the local Codex account and refuses a changed binding on retry', () => {
    const initial = fixture();
    const codex = {
      ...initial,
      selection: { ...initial.selection, provider: 'codex', model: 'codex:gpt-6:high' },
      cliBinding: {
        kind: 'LOCAL_ACCOUNT' as const,
        fingerprint: 'd'.repeat(64),
        revision: 'config',
      },
    };
    expect(admitAssessmentFence(null, codex)).toEqual(codex);
    expect(() => admitAssessmentFence(null, { ...codex, cliBinding: null })).toThrow();
    expect(() =>
      admitAssessmentFence(codex, {
        ...codex,
        cliBinding: { ...codex.cliBinding, fingerprint: 'e'.repeat(64) },
      })
    ).toThrow(/already active/);
    expect(() =>
      admitAssessmentFence(null, { ...initial, cliBinding: codex.cliBinding })
    ).toThrow();
  });

  it('reauthorizes the exact captured source before later work', () => {
    const first = fixture();
    const source = {
      classId: first.classId,
      courseId: first.courseId,
      userId: first.userId,
      classAttempt: first.classAttempt,
      formativeRevision: first.formativeRevision,
      teachingReceipt: first.teachingReceipt,
      ownership: first.ownership,
      requirements: first.requirements,
      thresholds: first.thresholds,
    };
    expect(() => assertAssessmentFenceSource(first, source)).not.toThrow();
    expect(() => assertAssessmentFenceSource(first, { ...source, classAttempt: 2 })).toThrow(
      /needs recovery/
    );
    expect(() =>
      assertAssessmentFenceSource(first, {
        ...source,
        teachingReceipt: { kind: 'BASE', receiptId: 'new' },
      })
    ).toThrow(/needs recovery/);
    expect(() => assertAssessmentFenceSource({ ...first, status: 'UNRESOLVED' }, source)).toThrow(
      /needs recovery/
    );
  });
});
