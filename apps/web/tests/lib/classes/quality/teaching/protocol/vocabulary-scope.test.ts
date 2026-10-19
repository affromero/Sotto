// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import type { AIOptions, AIProvider, ChatMessage } from '@/lib/providers/ai';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import {
  reviewTeachingContent,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { teachingNovelFindingReceipts } from '@/lib/classes/quality/teaching-source/novel-findings';
import { sectionReviewInput } from '@/lib/classes/section-quality';

const binding = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../../../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

type Question = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  passageRef: string;
};
type Payload = {
  exerciseMode?: 'vocabulary_recall';
  items: Array<{
    index: number;
    content: Question;
    completedOptions?: string[];
    sourceParts: Array<{ index: number; fieldPath: string[]; quote: string }>;
  }>;
  criticisms?: { items: Array<{ index: number; findings: unknown[] }> };
  novelFindingProposals?: Array<{ itemIndex: number; findingIndex: number }>;
};
type Case = {
  name: string;
  candidate: Question;
  field: 'question' | 'explanation';
  defect: string;
  correction: string;
  decision: 'supported' | 'dismissed';
  reason: string;
};
const listening = {
  question:
    'Amir soll aufmerksam hören und selbst nicht sprechen. Wähle die Option, die diese Handlung beschreibt und den Satz ergänzt.\nAmir soll _____, wenn die Lehrerin spricht.',
  options: ['zuhören', 'antworten', 'vorlesen', 'mitschreiben'],
  correctIndex: 0,
  explanation:
    '„Zuhören“ passt, weil Amir die Worte der Lehrerin aufmerksam hört und dabei selbst nicht spricht.',
  passageRef: '',
};
const river = {
  question:
    'Unter der Brücke fließt ein breites natürliches Gewässer durch mehrere Städte bis zum Meer. Wähle die passende Bezeichnung und ergänze den Satz.\nVon der Brücke aus sehen wir den _____ unter uns; das breite Wasser fließt durch mehrere Städte bis zum Meer.',
  options: ['Fluss', 'See', 'Berg', 'Wald'],
  correctIndex: 0,
  explanation:
    'Ein „Fluss“ ist ein breites natürliches Gewässer mit fließendem Wasser, das bis zum Meer führen kann.',
  passageRef: '',
};
const cases: Case[] = [
  {
    name: 'rejects a tested word disclosed through an inflected public clue',
    candidate: {
      question:
        'Der Termin dauert vier Stunden. Ergänze das Verb.\nDer Termin soll vier Stunden _____.',
      options: ['beginnen', 'enden', 'dauern', 'warten'],
      correctIndex: 2,
      explanation: 'Dauern beschreibt die Zeitspanne des Termins.',
      passageRef: '',
    },
    field: 'question',
    defect: 'The public clue discloses dauern through dauert before the learner answers.',
    correction: 'Give the start and end times without naming the tested verb.',
    decision: 'supported',
    reason: 'Dauert is the inflected target and reveals the requested word.',
  },
  {
    name: 'allows the selected word in the private post-answer explanation',
    candidate: {
      question:
        'Der Termin beginnt um neun und endet um dreizehn Uhr.\nEr soll vier Stunden _____.',
      options: ['beginnen', 'enden', 'dauern', 'warten'],
      correctIndex: 2,
      explanation: 'Der Termin dauert vier Stunden; dauern beschreibt hier die Zeitspanne.',
      passageRef: '',
    },
    field: 'explanation',
    defect: 'The explanation names dauert and therefore reveals the selected word.',
    correction: 'Remove the tested verb from the explanation.',
    decision: 'dismissed',
    reason: 'The explanation is shown after the answer; the public clue does not name the verb.',
  },
  {
    name: 'dismisses a different activity that could accompany the requested listening action',
    candidate: listening,
    field: 'question',
    defect: 'Mitschreiben can accompany attentive silent listening, so it is another answer.',
    correction: 'Require Amir not to write anything.',
    decision: 'dismissed',
    reason: 'The task asks for hearing; mitschreiben denotes writing, a different action.',
  },
  {
    name: 'rejects a genuine alternative expressing the requested action',
    candidate: { ...listening, options: ['zuhören', 'hinhören', 'antworten', 'vorlesen'] },
    field: 'question',
    defect: 'Zuhören and hinhören both express attentive hearing under the public task.',
    correction: 'Replace hinhören with an option that does not express attentive hearing.',
    decision: 'supported',
    reason: 'Both listening verbs satisfy the explicitly requested action.',
  },
  {
    name: 'rejects venue ambiguity when the stated exhibition does not distinguish the places',
    candidate: {
      question:
        'Gesucht ist der Ort mit einer Ausstellung über die Geschichte der Stadt. Wähle die passende Option, um den Satz zu ergänzen.\nAm Samstag besuchen wir das _____; dort gibt es eine Ausstellung über die Geschichte unserer Stadt.',
      options: ['Stadtpark', 'Rathaus', 'Stadtmuseum', 'Bahnhof'],
      correctIndex: 2,
      explanation:
        'Im „Stadtmuseum“ kann man eine Ausstellung über die Geschichte der Stadt sehen.',
      passageRef: '',
    },
    field: 'question',
    defect: 'A Rathaus can also host the stated exhibition; no public fact distinguishes it.',
    correction: 'Specify the place function rather than only its temporary exhibition.',
    decision: 'supported',
    reason: 'Both venues satisfy the supplied exhibition context without changing the task.',
  },
  {
    name: 'rejects a generic lexical definition that makes scene width necessary',
    candidate: river,
    field: 'explanation',
    defect: 'The generic river definition makes width necessary, although rivers can be narrow.',
    correction: 'Explain flowing water here without defining all rivers as broad.',
    decision: 'supported',
    reason: 'A broad river in this scene does not establish width as a defining property.',
  },
  {
    name: 'preserves an explicitly contextual description of the broad river',
    candidate: {
      ...river,
      explanation: 'Der „Fluss“ ist hier breit; sein Wasser fließt durch mehrere Städte zum Meer.',
    },
    field: 'explanation',
    defect: 'Mentioning width is incorrect because rivers can also be narrow.',
    correction: 'Remove the width from this description.',
    decision: 'dismissed',
    reason: 'Hier explicitly limits the accurate width description to the supplied scene.',
  },
];

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('contextual vocabulary meaning across paired review and corroboration', () => {
  let instance: SharedTestInstance;
  let identity: { ownerId: string; ownerToken: string };
  let ai: CapturedLearningAi;
  const requests: Array<{ schema: string; system: string; payload: Payload }> = [];

  beforeAll(async () => {
    instance = await createSharedTestInstance('vocabulary_scope');
    binding.database = instance.database;
    identity = await instance.reset();
  });
  beforeEach(() => {
    const request = new Request('http://localhost/api/v1/classes', {
      headers: { cookie: `sotto_session=${identity.ownerToken}` },
    });
    ai = {
      provider: 'codex',
      model: 'captured-review-model',
      execution: {
        userId: identity.ownerId,
        signal: new AbortController().signal,
        authorize: async (database) => {
          const current = await resolveSottoRequest(database, request);
          if (!current || current.kind !== 'content') throw new Error('Fixture admission expired');
          return current;
        },
      },
    };
    requests.length = 0;
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });

  function provider(finding: Case, origin: 'critic' | 'adjudicator'): AIProvider {
    return {
      async generateResponse(system: string, messages: ChatMessage[], options?: AIOptions) {
        if (!options?.jsonSchema) throw new Error('A canonical review schema is required');
        const schema = options.jsonSchema.name;
        const payload = JSON.parse(messages[0].content as string) as Payload;
        requests.push({ schema, system, payload: structuredClone(payload) });
        let response: unknown;
        if (schema === 'class_teaching_novel_finding_corroboration') {
          response = {
            decisions: payload.novelFindingProposals!.map(({ itemIndex, findingIndex }) => ({
              itemIndex,
              findingIndex,
              decision: finding.decision,
              reason: finding.reason,
            })),
          };
        } else {
          const critic = schema === 'class_teaching_critic';
          if (!critic && schema !== 'class_teaching_adjudicator')
            throw new Error(`Unexpected provider role ${schema}`);
          response = {
            items: payload.items.map((row) => {
              const part = row.sourceParts.find((entry) => entry.fieldPath[0] === finding.field);
              if (!part) throw new Error('The exact finding source is missing');
              const proposed = {
                sourcePartIndex: part.index,
                issue: 'incorrect',
                rule: 'Evaluate the stated action and the scope of lexical claims.',
                defect: finding.defect,
                remedy: { kind: 'correction', text: finding.correction },
              };
              return critic
                ? { index: row.index, findings: origin === 'critic' ? [proposed] : [] }
                : {
                    index: row.index,
                    criticDecisions: (
                      payload.criticisms?.items.find((item) => item.index === row.index)
                        ?.findings ?? []
                    ).map((_, findingIndex) => ({
                      findingIndex,
                      decision: finding.decision,
                      reason: finding.reason,
                    })),
                    newFindings: origin === 'adjudicator' ? [proposed] : [],
                  };
            }),
          };
        }
        return {
          content: JSON.stringify(response),
          model: ai.model,
          inputTokens: 0,
          outputTokens: 0,
        };
      },
      async *streamResponse() {
        throw new Error('Review does not stream');
      },
    };
  }

  describe.each(['critic', 'adjudicator'] as const)('%s allegation', (origin) => {
    it.each(cases)('$name', async (finding) => {
      const before = structuredClone(finding.candidate);
      const result = reviewTeachingContent({
        ai,
        userId: identity.ownerId,
        provider: provider(finding, origin),
        kind: 'explanations',
        sectionSkill: 'GRAMMAR',
        exerciseMode: 'vocabulary_recall',
        level: 'A2',
        nativeLang: 'en',
        targetLang: 'de',
        lessonContext: {
          title: 'Wörter im Kontext',
          objective: 'Choose the word expressing the stated action or meaning.',
          grammarPoints: [],
        },
        items: [finding.candidate],
      });
      if (finding.decision === 'dismissed') await expect(result).resolves.toBeUndefined();
      else {
        const error = await result.catch((value: unknown) => value);
        expect(error).toBeInstanceOf(TeachingQualityRejectionError);
        if (!(error instanceof TeachingQualityRejectionError)) throw error;
        expect(error.issues).toContain('incorrect');
        expect(error.feedback[0].feedback.join(' ')).toContain(finding.defect);
        expect(JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].items).toEqual([before]);
      }
      const expectedRoles = ['class_teaching_critic', 'class_teaching_adjudicator'];
      if (origin === 'adjudicator')
        expectedRoles.push('class_teaching_novel_finding_corroboration');
      expect(requests.map(({ schema }) => schema)).toEqual(expectedRoles);
      const completions = JSON.parse(sectionReviewInput([before])).questions[0].completedOptions;
      for (const { system, payload } of requests) {
        expect(payload.exerciseMode).toBe('vocabulary_recall');
        expect(system).toContain('private');
        expect(system).toContain('public');
        expect(system).toContain('A different activity that could accompany that action');
        expect(system).toContain('Still retain true synonyms');
        expect(system).toContain('multiple plausible venues');
        expect(system).toContain(
          'Distinguish a contextual description from a general lexical definition'
        );
        expect(payload.items[0].content).toEqual(before);
        expect(payload.items[0].completedOptions).toEqual(completions);
      }
      if (origin === 'adjudicator')
        expect(teachingNovelFindingReceipts(ai)).toEqual([
          expect.objectContaining({
            status: 'completed',
            decisions: [expect.objectContaining({ decision: finding.decision })],
          }),
        ]);
      expect(finding.candidate).toEqual(before);
    });
  });
});
