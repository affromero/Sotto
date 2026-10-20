// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  objectiveEvidenceHash,
  objectiveTaskFingerprint,
  reviewedObjectiveAssessmentSchema,
  validateProductiveFinding,
} from '@/lib/learning-map/evidence/protocol';
import { assessmentFixture } from './evidence-fixtures';

describe('exact objective task identity', () => {
  it('keeps answer presentation changes from manufacturing new practice opportunities', () => {
    const assessed = assessmentFixture();
    if (assessed.task.kind !== 'KEYED_MULTIPLE_CHOICE') throw new Error('Expected keyed fixture.');
    const shuffled = {
      ...assessed.task,
      options: [...assessed.task.options].reverse(),
      correctIndex: 3,
    };
    expect(objectiveTaskFingerprint('de', assessed.criterion, shuffled)).toBe(
      assessed.taskFingerprint
    );
    expect(
      objectiveTaskFingerprint('de', assessed.criterion, { ...shuffled, correctIndex: 0 })
    ).not.toBe(assessed.taskFingerprint);
  });
  it('binds source content, criterion difficulty and rubric rather than generated row identifiers', () => {
    const assessed = assessmentFixture('READING');
    if (assessed.task.kind !== 'KEYED_MULTIPLE_CHOICE') throw new Error('Expected keyed fixture.');
    expect(
      objectiveTaskFingerprint('de', assessed.criterion, {
        ...assessed.task,
        passageText: 'Different late-page constraint.',
      })
    ).not.toBe(assessed.taskFingerprint);
    expect(
      objectiveTaskFingerprint('de', { ...assessed.criterion, level: 'C1' }, assessed.task)
    ).not.toBe(assessed.taskFingerprint);
    expect(
      objectiveTaskFingerprint(
        'de',
        { ...assessed.criterion, assessment: 'Negotiate a nuanced accommodation.' },
        assessed.task
      )
    ).not.toBe(assessed.taskFingerprint);
    expect(objectiveEvidenceHash({ source: 'a', nested: { b: 2, a: 1 } })).toBe(
      objectiveEvidenceHash({ nested: { a: 1, b: 2 }, source: 'a' })
    );
  });
  it('requires exact audio publication evidence and keeps media relocation from inventing a new task', () => {
    const assessed = assessmentFixture('LISTENING');
    expect(
      reviewedObjectiveAssessmentSchema.safeParse({ ...assessed, media: undefined }).success
    ).toBe(false);
    expect(
      reviewedObjectiveAssessmentSchema.safeParse({
        ...assessed,
        media: {
          ...assessed.media!,
          reference: { ...assessed.media!.reference, consumer: 'episode:another-episode:audio' },
        },
      }).success
    ).toBe(false);
    expect(
      reviewedObjectiveAssessmentSchema.safeParse({
        ...assessed,
        media: { ...assessed.media!, contentSha256: '0'.repeat(64) },
      }).success
    ).toBe(false);
    expect(
      reviewedObjectiveAssessmentSchema.parse({
        ...assessed,
        media: {
          ...assessed.media!,
          reference: { ...assessed.media!.reference, assetId: '0'.repeat(64) },
        },
      }).taskFingerprint
    ).toBe(assessed.taskFingerprint);
    if (assessed.task.kind !== 'KEYED_MULTIPLE_CHOICE') throw new Error('Expected keyed fixture.');
    expect(
      objectiveTaskFingerprint('de', assessed.criterion, {
        ...assessed.task,
        audio: { ...assessed.task.audio!, contentSha256: '0'.repeat(64) },
      })
    ).not.toBe(assessed.taskFingerprint);
  });
  it('rejects background quotes, skill substitution and changed rubric snapshots', () => {
    const assessed = assessmentFixture();
    expect(
      reviewedObjectiveAssessmentSchema.safeParse({
        ...assessed,
        review: { ...assessed.review, elicitationQuote: 'not in the task' },
      }).success
    ).toBe(false);
    expect(
      reviewedObjectiveAssessmentSchema.safeParse({
        ...assessed,
        criterion: { ...assessed.criterion, skill: 'SPEAKING' },
      }).success
    ).toBe(false);
    expect(
      reviewedObjectiveAssessmentSchema.safeParse({
        ...assessed,
        scope: {
          ...assessed.scope,
          criteria: [{ ...assessed.criterion, assessment: 'Different rubric.' }],
        },
      }).success
    ).toBe(false);
  });
});

describe('supported productive criterion findings', () => {
  it('requires the actual response, task and independent quotations', () => {
    const assessed = assessmentFixture('WRITING');
    const response = 'Ich möchte bitte ein Gericht ohne Fleisch.';
    const finding = {
      schemaVersion: 1,
      taskFingerprint: assessed.taskFingerprint,
      responseSha256: objectiveEvidenceHash({ text: response }),
      assessed: true,
      quality: 0.8,
      quotes: ['ohne Fleisch'],
      rationale: 'The learner politely requests a meat-free dish.',
    };
    expect(validateProductiveFinding(assessed, response, finding).quality).toBe(0.8);
    expect(() => validateProductiveFinding(assessed, `${response} Changed.`, finding)).toThrow(
      /independent learner work/
    );
    expect(() =>
      validateProductiveFinding(assessed, response, { ...finding, quotes: ['invented words'] })
    ).toThrow(/independent learner work/);
  });
  it('does not turn copied support or an unassessed response into mastery', () => {
    const assessed = assessmentFixture('WRITING', {
      kind: 'ORIGINAL_WRITING',
      task: 'Request a vegetarian meal and explain your dietary constraint.',
      guidance: null,
      suppliedSupport: ['Ich möchte ohne Fleisch essen.'],
    });
    const response = 'Ich möchte ohne Fleisch essen.';
    const finding = {
      schemaVersion: 1,
      taskFingerprint: assessed.taskFingerprint,
      responseSha256: objectiveEvidenceHash({ text: response }),
      assessed: true,
      quality: 1,
      quotes: [response],
      rationale: 'The copied sentence repeats the complete supplied answer.',
    };
    expect(() => validateProductiveFinding(assessed, response, finding)).toThrow(
      /independent learner work/
    );
    expect(
      validateProductiveFinding(assessed, response, {
        ...finding,
        assessed: false,
        quality: null,
        quotes: [],
      }).assessed
    ).toBe(false);
  });
});
