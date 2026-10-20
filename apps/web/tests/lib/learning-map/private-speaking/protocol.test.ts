// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { privateSpeakingFixture } from './fixtures';
import {
  assertPrivateSpeakingSession,
  privateSpeakingAssessmentSchema,
} from '@/lib/learning-map/evidence/private-speaking/protocol';
import {
  speakingTaskMode,
  speakingAssessmentScope,
} from '@/lib/learning-map/evidence/communicative-speaking';
import { productiveObservation } from '@/lib/learning-map/evidence/submission';
import { focusedPracticeKinds } from '@/lib/learning-map/selection';

describe('independent private source speaking feedback', () => {
  const { selection, assessment } = privateSpeakingFixture();
  const owned = {
    assessment,
    userId: 'user-1',
    courseId: 'course-1',
    targetLang: 'de',
    level: 'A2',
    selection,
    task: assessment.task.kind === 'COMMUNICATIVE_SPEAKING' ? assessment.task.task : '',
    guidance: assessment.task.kind === 'COMMUNICATIVE_SPEAKING' ? assessment.task.guidance : null,
  };
  it('binds the exact source receipt and independent elicitation without manufacturing canonical criteria', () => {
    expect(assertPrivateSpeakingSession(owned)).toEqual(assessment);
    expect(selection.objectives).toEqual([]);
    expect(speakingTaskMode(assessment)).toBe('COMMUNICATIVE');
    expect(speakingAssessmentScope(assessment)).toBe('PRIVATE_SOURCE');
    expect(JSON.stringify(assessment)).not.toMatch(
      /objectiveId|detailsBase64|sourceContext|answerTranscript/
    );
  });
  it.each([
    { userId: 'foreign' },
    { courseId: 'foreign' },
    { targetLang: 'es' },
    { level: 'B1' },
    { task: 'Read this supplied answer aloud.' },
    { guidance: 'Use the supplied transcript.' },
    {
      selection: {
        ...selection,
        sourceFocus: { ...selection.sourceFocus, focusDigest: 'f'.repeat(64) },
      },
    },
    { selection: { ...selection, sourceFocus: { ...selection.sourceFocus, analysisRevision: 4 } } },
    { selection: null },
  ])('rejects a changed owner, source, difficulty or actual task before grading (%j)', (change) => {
    expect(() => assertPrivateSpeakingSession({ ...owned, ...change })).toThrow();
  });
  it('rejects changes to the reviewed private rubric or any synthetic objective identity', () => {
    expect(() =>
      privateSpeakingAssessmentSchema.parse({
        ...assessment,
        rubric: 'Assess generic pronunciation only.',
      })
    ).toThrow();
    expect(() =>
      privateSpeakingAssessmentSchema.parse({ ...assessment, objectiveId: 'invented' })
    ).toThrow();
  });
  it('makes source-only speaking available only with the pinned configured skill', () => {
    const configured = createSkillRequirements({
      scope: 'FULL',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A2',
      ttsProvider: 'local',
      sttProvider: 'local',
    });
    expect(focusedPracticeKinds(selection, configured)).toContain('SPEAKING');
    expect(focusedPracticeKinds(selection, configured)).toContain('FULL');
    expect(
      focusedPracticeKinds(
        selection,
        createSkillRequirements({
          scope: 'FULL',
          nativeLang: 'en',
          targetLang: 'de',
          level: 'A2',
          ttsProvider: null,
          sttProvider: null,
        })
      )
    ).not.toContain('SPEAKING');
  });
  it('excludes private feedback from canonical productive observations even with a scored finding', () => {
    expect(
      productiveObservation({
        courseId: 'course-1',
        userId: 'user-1',
        sessionId: 'private-session',
        sourceType: 'SPEAKING_CRITERION',
        assessment,
        task: assessment.task,
        text: 'Ich werde im Mai umziehen.',
        finding: { quality: 1 },
      })
    ).toBeNull();
  });
});
