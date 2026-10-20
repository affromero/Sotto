// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  multipleChoiceObservation,
  productiveObservation,
} from '@/lib/learning-map/evidence/submission';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { speakingTaskMode } from '@/lib/learning-map/evidence/communicative-speaking';
import { assessmentFixture } from './evidence-fixtures';

const work = { courseId: 'course-1', userId: 'user-1', sessionId: 'practice:session-1' };
describe('assessment observations from committed learner answers', () => {
  it('uses the actual answer key and keeps an unchanged task stable across repeated sessions', () => {
    const assessed = assessmentFixture();
    const input = {
      ...work,
      sourceType: 'PRACTICE_QUESTION' as const,
      skill: 'GRAMMAR' as const,
      assessment: assessed,
      task: assessed.task,
      selectedIndex: 0,
    };
    expect(multipleChoiceObservation(input)).toMatchObject({
      quality: 1,
      taskId: assessed.taskFingerprint,
    });
    expect(multipleChoiceObservation({ ...input, selectedIndex: 1 })).toMatchObject({ quality: 0 });
    const again = multipleChoiceObservation({ ...input, sessionId: 'practice:different-session' })!;
    expect(again.taskId).toBe(assessed.taskFingerprint);
    expect(again.responseIdentity).toBe(multipleChoiceObservation(input)!.responseIdentity);
  });
  it('leaves teaching-only items unknown and rejects edited tasks or cross-course credit', () => {
    const assessed = assessmentFixture();
    const input = {
      ...work,
      sourceType: 'CLASS_QUESTION' as const,
      skill: 'GRAMMAR' as const,
      assessment: assessed,
      task: assessed.task,
      selectedIndex: 0,
    };
    expect(multipleChoiceObservation({ ...input, assessment: null })).toBeNull();
    expect(() => multipleChoiceObservation({ ...input, courseId: 'other-course' })).toThrow(
      /changed/
    );
    expect(() => multipleChoiceObservation({ ...input, selectedIndex: 9 })).toThrow(
      /valid learner answer/
    );
    if (assessed.task.kind !== 'KEYED_MULTIPLE_CHOICE') throw new Error('Expected keyed fixture.');
    const task = assessed.task;
    expect(() =>
      multipleChoiceObservation({ ...input, task: { ...task, question: 'An edited task.' } })
    ).toThrow(/changed/);
  });
  it('uses only a supported criterion finding rather than an aggregate productive score', () => {
    const assessed = assessmentFixture('WRITING');
    const text = 'Ich möchte ohne Fleisch essen, bitte.';
    const finding = {
      schemaVersion: 1,
      taskFingerprint: assessed.taskFingerprint,
      responseSha256: objectiveEvidenceHash({ text }),
      assessed: true,
      quality: 0.3,
      quotes: ['ohne Fleisch'],
      rationale: 'The response states the constraint with incomplete task negotiation.',
    };
    const input = {
      ...work,
      sourceType: 'WRITING_CRITERION' as const,
      assessment: assessed,
      task: assessed.task,
      text,
      finding,
    };
    expect(productiveObservation(input)).toMatchObject({ quality: 0.3, skill: 'WRITING' });
    expect(productiveObservation({ ...input, finding: null })).toBeNull();
    expect(
      productiveObservation({
        ...input,
        finding: { ...finding, assessed: false, quality: null, quotes: [] },
      })
    ).toBeNull();
  });
  it('qualifies free speaking while excluding read-aloud and writing substitutions', () => {
    const assessed = assessmentFixture('SPEAKING');
    const text = 'Bitte ein vegetarisches Gericht.';
    const finding = {
      schemaVersion: 1,
      taskFingerprint: assessed.taskFingerprint,
      responseSha256: objectiveEvidenceHash({ text }),
      assessed: true,
      quality: 0.7,
      quotes: ['vegetarisches Gericht'],
      rationale: 'The learner independently states the required dietary constraint.',
    };
    expect(speakingTaskMode(null)).toBe('READ_ALOUD');
    expect(speakingTaskMode(assessed)).toBe('COMMUNICATIVE');
    expect(
      productiveObservation({
        ...work,
        sourceType: 'SPEAKING_CRITERION',
        assessment: assessed,
        task: assessed.task,
        text,
        finding,
      })
    ).toMatchObject({ skill: 'SPEAKING', quality: 0.7 });
    expect(() => speakingTaskMode(assessmentFixture('WRITING'))).toThrow(
      /independent communicative/
    );
    expect(() =>
      productiveObservation({
        ...work,
        sourceType: 'WRITING_CRITERION',
        assessment: assessed,
        task: assessed.task,
        text,
        finding,
      })
    ).toThrow(/independently elicited/);
  });
});
