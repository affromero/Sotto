// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async () => ({ provider: 'configured', model: 'configured-model' }),
  capturedLearningAiOptions: async () => ({}),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: boundary.respond }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { reviewObjectiveTasks } from '@/lib/learning-map/evidence/review';
import { gradeProductiveObjective } from '@/lib/learning-map/evidence/productive';
import { composeCommunicativeSpeakingPrompts } from '@/lib/learning-map/evidence/communicative-speaking';
import { objectiveEvidenceHash } from '@/lib/learning-map/evidence/protocol';
import { assessmentFixture } from './evidence-fixtures';
import { blockedProviderExecution } from '../../../helpers/runtime/provider-execution';

const execution = blockedProviderExecution('user-1');
beforeEach(() => {
  boundary.respond.mockReset();
});
function reviewer(
  transform: (value: {
    inputSha256: string;
    items: Array<{
      index: number;
      objectiveId: string | null;
      elicitationQuote: string;
      rationale: string;
    }>;
  }) => unknown = (value) => value
) {
  boundary.respond.mockImplementation(
    async (_system: string, messages: Array<{ content: string }>) => {
      const input = JSON.parse(messages[0]!.content);
      const value = {
        inputSha256: input.inputSha256,
        items: input.tasks.map((task: { question?: string; task?: string }, index: number) => ({
          index,
          objectiveId: input.scope.criteria[0].objectiveId,
          elicitationQuote: task.question ?? task.task,
          rationale: 'The actual task requires the supplied polite request and constraint.',
        })),
      };
      return { content: JSON.stringify(transform(value)), model: 'configured-model' };
    }
  );
}
describe('independent criterion attribution', () => {
  it('preserves only directly reviewed exact criteria after existing generation quality checks', async () => {
    const assessed = assessmentFixture('READING');
    reviewer();
    const [result] = await reviewObjectiveTasks({
      userId: 'user-1',
      execution,
      scope: assessed.scope,
      skill: 'READING',
      tasks: [assessed.task],
    });
    expect(result).toMatchObject({
      criterion: assessed.criterion,
      taskFingerprint: assessed.taskFingerprint,
    });
    reviewer((value) => ({
      ...value,
      items: value.items.map((item) => ({ ...item, objectiveId: null, elicitationQuote: '' })),
    }));
    expect(
      await reviewObjectiveTasks({
        userId: 'user-1',
        execution,
        scope: assessed.scope,
        skill: 'READING',
        tasks: [assessed.task],
      })
    ).toEqual([null]);
  });
  it.each(['unknown criterion', 'lost inventory', 'forged quote', 'wrong digest'])(
    'rejects %s without attributing credit',
    async (problem) => {
      const assessed = assessmentFixture();
      reviewer((value) =>
        problem === 'unknown criterion'
          ? { ...value, items: value.items.map((item) => ({ ...item, objectiveId: 'invented' })) }
          : problem === 'lost inventory'
            ? { ...value, items: [] }
            : problem === 'forged quote'
              ? {
                  ...value,
                  items: value.items.map((item) => ({
                    ...item,
                    elicitationQuote: 'invented source',
                  })),
                }
              : { ...value, inputSha256: '0'.repeat(64) }
      );
      await expect(
        reviewObjectiveTasks({
          userId: 'user-1',
          execution,
          scope: assessed.scope,
          skill: 'GRAMMAR',
          tasks: [assessed.task],
        })
      ).rejects.toThrow();
    }
  );
  it('retains listening as pending until the exact canonical audio exists', async () => {
    const assessed = assessmentFixture('LISTENING');
    reviewer();
    if (assessed.task.kind !== 'KEYED_MULTIPLE_CHOICE') throw new Error('Expected keyed fixture.');
    const [result] = await reviewObjectiveTasks({
      userId: 'user-1',
      execution,
      scope: assessed.scope,
      skill: 'LISTENING',
      tasks: [{ ...assessed.task, audio: null }],
      pendingListeningScriptSha256: 'b'.repeat(64),
    });
    expect(result).toMatchObject({ status: 'AWAITING_MEDIA', task: { audio: null } });
    expect(result).not.toHaveProperty('taskFingerprint');
  });
});
describe('criterion-specific productive grading', () => {
  it('supports free speaking from actual transcript meaning without a reference answer', async () => {
    const assessed = assessmentFixture('SPEAKING');
    const text = 'Bitte ein vegetarisches Gericht.';
    boundary.respond.mockImplementation(
      async (_system: string, messages: Array<{ content: string }>) => {
        const input = JSON.parse(messages[0]!.content);
        expect(input.task.kind).toBe('COMMUNICATIVE_SPEAKING');
        expect(input.response).toBe(text);
        expect(input.task).not.toHaveProperty('answer');
        return {
          content: JSON.stringify({
            finding: {
              schemaVersion: 1,
              taskFingerprint: input.taskFingerprint,
              responseSha256: input.responseSha256,
              assessed: true,
              quality: 0.6,
              quotes: ['vegetarisches Gericht'],
              rationale: 'The independent request conveys the dietary constraint.',
            },
            feedback: 'State the reason as well.',
          }),
          model: 'configured-model',
        };
      }
    );
    expect(
      await gradeProductiveObjective({ userId: 'user-1', execution, assessment: assessed, text })
    ).toMatchObject({ finding: { quality: 0.6, responseSha256: objectiveEvidenceHash({ text }) } });
  });
  it('rejects hallucinated response quotes despite a positive reported score', async () => {
    const assessed = assessmentFixture('WRITING');
    const text = 'Hallo.';
    boundary.respond.mockResolvedValue({
      content: JSON.stringify({
        finding: {
          schemaVersion: 1,
          taskFingerprint: assessed.taskFingerprint,
          responseSha256: objectiveEvidenceHash({ text }),
          assessed: true,
          quality: 1,
          quotes: ['vegetarian meal'],
          rationale: 'The response supposedly addresses the dietary constraint.',
        },
        feedback: 'A request was made.',
      }),
      model: 'configured-model',
    });
    await expect(
      gradeProductiveObjective({ userId: 'user-1', execution, assessment: assessed, text })
    ).rejects.toThrow(/independent learner work/);
  });
});

describe('independent communicative speaking generation', () => {
  it('authors reviewed role tasks without a reference answer or pronunciation audio', async () => {
    const assessed = assessmentFixture('SPEAKING');
    if (assessed.task.kind !== 'COMMUNICATIVE_SPEAKING')
      throw new Error('Expected communicative fixture.');
    const task = assessed.task;
    reviewer();
    boundary.respond.mockResolvedValueOnce({
      model: 'configured-model',
      content: JSON.stringify({ prompts: [{ task: task.task, guidance: task.guidance }] }),
    });
    const [prompt] = await composeCommunicativeSpeakingPrompts({
      userId: 'user-1',
      execution,
      scope: assessed.scope,
      nativeLang: 'en',
      count: 1,
    });
    expect(prompt).toMatchObject({
      taskMode: 'COMMUNICATIVE',
      targetPhrase: task.task,
      translation: task.guidance,
      ipa: null,
      referenceTtsAudio: null,
      learningObjectives: { criterion: { skill: 'SPEAKING' } },
    });
    expect(prompt).not.toHaveProperty('modelAnswer');
  });
  it('rejects a supplied model answer instead of converting a read-aloud exercise into communicative evidence', async () => {
    const assessed = assessmentFixture('SPEAKING');
    boundary.respond.mockResolvedValue({
      model: 'configured-model',
      content: JSON.stringify({
        prompts: [
          {
            task: 'Ask politely for a vegetarian meal.',
            guidance: 'State your constraint.',
            modelAnswer: 'Ich möchte etwas ohne Fleisch.',
          },
        ],
      }),
    });
    await expect(
      composeCommunicativeSpeakingPrompts({
        userId: 'user-1',
        execution,
        scope: assessed.scope,
        nativeLang: 'en',
        count: 1,
      })
    ).rejects.toThrow();
  });
});
