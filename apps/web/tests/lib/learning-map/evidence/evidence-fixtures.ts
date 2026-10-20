import type { SkillType } from '@sotto/shared';
import {
  objectiveAssessmentScopeSchema,
  objectiveTaskFingerprint,
  reviewedObjectiveAssessmentSchema,
  type ObjectiveTask,
} from '@/lib/learning-map/evidence/protocol';

export function assessmentFixture(skill: SkillType = 'GRAMMAR', override?: ObjectiveTask) {
  const criterion = {
    objectiveId: 'de.grammar.request',
    criterionVersion: 1,
    policyVersion: 1,
    level: 'A2' as const,
    skill,
    assessment: 'Formulate a polite request that includes the stated dietary constraint.',
  };
  const scope = objectiveAssessmentScopeSchema.parse({
    schemaVersion: 1,
    courseId: 'course-1',
    userId: 'user-1',
    bindingId: 'binding-1',
    catalogHash: 'a'.repeat(64),
    targetLang: 'de',
    level: 'A2',
    criteria: [criterion],
  });
  const task: ObjectiveTask =
    override ??
    (skill === 'WRITING' || skill === 'SPEAKING'
      ? {
          kind: skill === 'WRITING' ? 'ORIGINAL_WRITING' : 'COMMUNICATIVE_SPEAKING',
          task: 'Request a vegetarian meal and explain your dietary constraint.',
          guidance: 'Address the server politely.',
          suppliedSupport: [],
        }
      : {
          kind: 'KEYED_MULTIPLE_CHOICE',
          question: 'Which request politely states the dietary constraint?',
          options: [
            'Ich möchte etwas ohne Fleisch, bitte.',
            'Die Rechnung, bitte.',
            'Ich esse alles.',
            'Wo ist der Bahnhof?',
          ],
          correctIndex: 0,
          passageText: skill === 'GRAMMAR' ? null : 'The guest needs a vegetarian meal.',
          audio:
            skill === 'LISTENING'
              ? { scriptSha256: 'b'.repeat(64), contentSha256: 'c'.repeat(64) }
              : null,
        });
  const media =
    skill === 'LISTENING'
      ? {
          schemaVersion: 1 as const,
          episodeId: 'episode-1',
          userId: 'user-1',
          scriptSha256: 'b'.repeat(64),
          contentSha256: 'c'.repeat(64),
          contentBytes: 1234,
          audioGenerationKey: 'generation-1',
          version: 1,
          reference: {
            consumer: 'episode:episode-1:audio',
            reference: '/api/storage/exact.mp3',
            assetId: 'd'.repeat(64),
            backendId: 'e'.repeat(64),
            binding: 'f'.repeat(64),
            key: 'episodes/episode-1/audio/exact.mp3',
          },
        }
      : undefined;
  return reviewedObjectiveAssessmentSchema.parse({
    schemaVersion: 1,
    scope,
    criterion,
    task,
    taskFingerprint: objectiveTaskFingerprint('de', criterion, task),
    ...(media ? { media } : {}),
    review: {
      protocol: 'DIRECT_CRITERION_ELICITATION_V1',
      provider: 'configured',
      model: 'configured-model',
      inputSha256: '1'.repeat(64),
      responseSha256: '2'.repeat(64),
      elicitationQuote: task.kind === 'KEYED_MULTIPLE_CHOICE' ? task.question : task.task,
      rationale: 'The task requires a polite request and the explicit dietary constraint.',
    },
  });
}
