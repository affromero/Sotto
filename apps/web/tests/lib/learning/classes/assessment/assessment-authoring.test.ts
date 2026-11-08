import { describe, expect, it } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { prerequisitePublicSourceSchema } from '@/lib/classes/help/content/prerequisite-source';
import { authorAssessmentSection } from '@/lib/learning/classes/generation/assessment-authoring';
import {
  assessmentReviewPayload,
  reviewAssessmentDraft,
  reviewSections,
  reviewSectionsFromDrafts,
} from '@/lib/learning/classes/review/assessment-review';
import { learningScriptTranscript } from '@/lib/learning/script-hash';
import { requirePriorAssessmentReviewCapacity } from '@/lib/learning/classes/generation/assessment-admission';
import {
  assessmentMaterialDigest,
  type PrivateAssessmentMaterial,
} from '@/lib/learning/classes/material/assessment-material';
import { sampleTeaching } from '../../../../helpers/learning/class-teaching';
import {
  READ_ALOUD_ASSESSMENT_POLICY,
  READ_ALOUD_ASSESSMENT_RUBRIC,
  readAloudPolicyForPractice,
} from '@/lib/learning/classes/speaking/assessment-speaking-policy';

const guidedPractice = {
  prompt: sampleTeaching.guidedPractice.prompt,
  hint: sampleTeaching.guidedPractice.hint,
};
const source = prerequisitePublicSourceSchema.parse({
  course: { nativeLang: 'es', targetLang: 'ru' },
  lesson: { level: 'A1', title: 'Saludos', objective: 'Saludar' },
  teaching: { ...sampleTeaching, guidedPractice },
  sections: ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'].map((skill) => ({
    id: skill,
    skill,
    attempt: 1,
    status: 'READY',
    questions: [],
    speaking: [],
    writing: [],
    listening: null,
  })),
});
const requirements = createSkillRequirements({
  scope: 'CLASS',
  nativeLang: 'es',
  targetLang: 'ru',
  level: 'A1',
  ttsProvider: 'configured',
  sttProvider: 'configured',
});
const grammarRequirement = requirements.skills.GRAMMAR;
if (grammarRequirement.state !== 'REQUIRED') throw new Error('Grammar fixture must be required');
const question = {
  question: 'Choose a greeting',
  options: ['a', 'b', 'c', 'd'],
  correctIndex: 1,
  explanation: 'Because',
};

describe('assessment review', () => {
  it('preserves the speaking practice mode when selecting the scorer policy', () => {
    expect(readAloudPolicyForPractice([{ taskMode: 'READ_ALOUD' }])).toBe(
      READ_ALOUD_ASSESSMENT_POLICY
    );
    expect(readAloudPolicyForPractice([{ taskMode: 'COMMUNICATIVE' }])).toBeUndefined();
    expect(
      readAloudPolicyForPractice([{ taskMode: 'READ_ALOUD' }, { taskMode: 'COMMUNICATIVE' }])
    ).toBeUndefined();
    expect(readAloudPolicyForPractice([])).toBeUndefined();
  });
  it('accepts read-aloud tasks only under the existing transcript and timing policy', async () => {
    const requirement = requirements.skills.SPEAKING;
    if (requirement.state !== 'REQUIRED') throw new Error('Speaking fixture must be required');
    const input = {
      source,
      prerequisite: null,
      requirements,
      skill: 'SPEAKING' as const,
      speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY,
    } as const;
    const item = {
      task: 'Привет, сосед!',
      mode: 'READ_ALOUD',
      translation: 'Hola, vecino',
      rubric: READ_ALOUD_ASSESSMENT_RUBRIC,
      guidance: 'Lee la frase en voz alta.',
    };
    const draft = {
      skill: 'SPEAKING',
      items: Array.from({ length: requirement.expectedCount }, () => item),
    };
    const accepted = await authorAssessmentSection(input, async (request) => {
      expect(request.system).toContain('Do not claim to assess accent');
      expect(JSON.stringify(request.schema)).toContain(READ_ALOUD_ASSESSMENT_RUBRIC);
      return JSON.stringify(draft);
    });
    expect(accepted).toEqual(draft);
    for (const invalid of [
      { ...item, mode: 'COMMUNICATIVE' },
      { ...item, rubric: 'Assess pronunciation and accent.' },
    ]) {
      await expect(
        authorAssessmentSection(input, async () =>
          JSON.stringify({
            ...draft,
            items: Array.from({ length: requirement.expectedCount }, () => invalid),
          })
        )
      ).rejects.toThrow();
    }
  });
  it('reserves room for the new assessment before admitting a retake', () => {
    expect(() =>
      requirePriorAssessmentReviewCapacity({
        lesson: source,
        prerequisite: null,
        priorTasks: [['A short prior task']],
      })
    ).not.toThrow();
    expect(() =>
      requirePriorAssessmentReviewCapacity({
        lesson: source,
        prerequisite: null,
        priorTasks: [['x'.repeat(18_000)]],
      })
    ).toThrow(/too large to review/);
  });
  const assessment: PrivateAssessmentMaterial = {
    version: 1,
    id: 'private-assessment',
    classId: 'class',
    courseId: 'course',
    userId: 'user',
    classAttempt: 1,
    assessmentAttempt: 1,
    formativeRevision: 'revision',
    requirements,
    sections: [
      ...(['GRAMMAR', 'READING', 'LISTENING'] as const).map((skill) => {
        const requirement = requirements.skills[skill];
        if (requirement.state !== 'REQUIRED') throw new Error('Skill fixture must be required');
        return {
          id: `section-${skill}`,
          skill,
          passThreshold: 0.7,
          passageText: skill === 'READING' ? 'Passage' : null,
          audio:
            skill === 'LISTENING'
              ? {
                  episodeId: 'private-episode',
                  mediaIdentity: 'private-media',
                  privateTranscript: 'Привет',
                }
              : null,
          items: Array.from({ length: requirement.expectedCount }, (_, index) => ({
            id: `${skill}-${index}`,
            ...question,
          })),
        };
      }),
      {
        id: 'speaking',
        skill: 'SPEAKING',
        passThreshold: 0.7,
        items: Array.from({ length: 4 }, (_, index) => ({
          id: `speaking-${index}`,
          task: `Speak ${index}`,
          mode: 'READ_ALOUD',
          referenceAudioId: `private-reference-${index}`,
          privateRubric: 'Rubric',
          privateGuidance: 'Guidance',
          privateTranslation: 'Translation',
          privateIpa: null,
          privateLearningObjectives: null,
        })),
      },
      {
        id: 'writing',
        skill: 'WRITING',
        passThreshold: 0.7,
        items: Array.from({ length: 3 }, (_, index) => ({
          id: `writing-${index}`,
          task: `Write ${index}`,
          privateRubric: 'Rubric',
          privateGuidance: null,
          privateIdeas: [],
          privateLearningObjectives: null,
        })),
      },
    ],
  };
  const binding = {
    classId: 'class',
    courseId: 'course',
    userId: 'user',
    classAttempt: 1,
    formativeRevision: 'revision',
    requirements,
    source,
    prerequisite: null,
  };
  const good = {
    taught: true,
    independent: true,
    correct: true,
    unambiguous: true,
    appropriate: true,
    rubricsSound: true,
    answersConcealed: true,
    issues: [],
  };

  it('reviews the bound read-aloud policy without accepting unsupported rubrics', async () => {
    const material = structuredClone(assessment);
    const speaking = material.sections.find((section) => section.skill === 'SPEAKING');
    if (!speaking || speaking.skill !== 'SPEAKING') throw new Error('Speaking fixture missing');
    for (const item of speaking.items) item.privateRubric = READ_ALOUD_ASSESSMENT_RUBRIC;
    const input = {
      material,
      digest: assessmentMaterialDigest(material),
      speakingPolicy: READ_ALOUD_ASSESSMENT_POLICY,
    } as const;
    await expect(
      reviewAssessmentDraft(binding, input, async (request) => {
        expect(request.system).toContain('phrase intended to be read aloud');
        expect(request.system).toContain('do not claim acoustic');
        return JSON.stringify(good);
      })
    ).resolves.toMatchObject({ materialDigest: input.digest });
    speaking.items[0]!.privateRubric = 'Assess accent.';
    await expect(
      reviewAssessmentDraft(
        binding,
        { ...input, digest: assessmentMaterialDigest(material) },
        async () => JSON.stringify(good)
      )
    ).rejects.toThrow();
  });

  it('estimates the exact complete review input from staged drafts', () => {
    const material = structuredClone(assessment);
    const drafts = material.sections.map((section) => {
      if (section.skill === 'SPEAKING')
        return {
          skill: section.skill,
          items: section.items.map((item) => ({
            task: item.task,
            mode: item.mode,
            rubric: item.privateRubric,
            guidance: item.privateGuidance,
            translation: item.privateTranslation,
          })),
        };
      if (section.skill === 'WRITING') {
        for (const item of section.items) item.privateGuidance = 'Guía';
        return {
          skill: section.skill,
          items: section.items.map((item) => ({
            task: item.task,
            rubric: item.privateRubric,
            guidance: item.privateGuidance,
          })),
        };
      }
      const items = section.items.map(({ question, options, correctIndex, explanation }) => ({
        question,
        options,
        correctIndex,
        explanation,
      }));
      if (section.skill === 'READING')
        return { skill: section.skill, passage: section.passageText, items };
      if (section.skill === 'LISTENING') {
        const turns = [{ speaker: 'HOST', text: 'Привет "мир" \\ чай' }];
        if (!section.audio) throw new Error('listening fixture missing');
        section.audio.privateTranscript = learningScriptTranscript(turns);
        return { skill: section.skill, turns, items };
      }
      return { skill: section.skill, items };
    });
    expect(assessmentReviewPayload(binding, reviewSectionsFromDrafts(drafts))).toBe(
      assessmentReviewPayload(binding, reviewSections(material))
    );
    const excessive = structuredClone(drafts);
    for (const draft of excessive)
      for (const item of draft.items) {
        if ('question' in item && typeof item.question === 'string')
          item.question = 'x'.repeat(3_000);
      }
    expect(() => assessmentReviewPayload(binding, reviewSectionsFromDrafts(excessive))).toThrow(
      /too large to review/
    );
  });

  it('reviews exact private content without sending assessment or storage identities', async () => {
    let payload = '';
    const digest = assessmentMaterialDigest(assessment);
    const result = await reviewAssessmentDraft(
      binding,
      { material: assessment, digest },
      async (request) => {
        payload = request.payload;
        expect(request.system).not.toContain('require ACOUSTIC evidence');
        return JSON.stringify(good);
      }
    );
    expect(result).toEqual({ materialDigest: digest, formativeRevision: 'revision' });
    expect(payload).toContain('Привет');
    expect(payload).toContain('correctIndex');
    expect(payload).not.toContain('private-assessment');
    expect(payload).not.toContain('private-episode');
    expect(payload).not.toContain('private-media');
    expect(payload).not.toContain('private-reference');
  });

  it('asks the independent reviewer to check the evidence modality of each speaking criterion', async () => {
    const material: PrivateAssessmentMaterial = {
      ...assessment,
      version: 2,
      sections: assessment.sections.map((section) =>
        section.skill === 'SPEAKING'
          ? {
              ...section,
              items: section.items.map((item) => ({
                ...item,
                privateCriteria: [
                  {
                    id: 'meaning',
                    description: 'Conveys meaning',
                    modality: 'TRANSCRIPT' as const,
                  },
                ],
              })),
            }
          : section
      ),
    };
    const digest = assessmentMaterialDigest(material);
    const speaking = material.sections.find((section) => section.skill === 'SPEAKING');
    if (!speaking || speaking.skill !== 'SPEAKING') throw new Error('Missing speaking section');
    const drafts = [
      {
        skill: 'SPEAKING',
        items: speaking.items.map((item) => ({
          task: item.task,
          mode: item.mode,
          rubric: item.privateRubric,
          criteria: item.privateCriteria,
          guidance: item.privateGuidance,
          translation: item.privateTranslation,
        })),
      },
    ];
    expect(reviewSectionsFromDrafts(drafts)).toEqual(
      reviewSections(material).filter((section) => section.skill === 'SPEAKING')
    );
    await reviewAssessmentDraft(binding, { material, digest }, async (request) => {
      expect(request.system).toContain('Pronunciation, accent, articulation');
      expect(request.system).toContain('require ACOUSTIC evidence');
      expect(request.payload).toContain('Conveys meaning');
      expect(request.payload).toContain('TRANSCRIPT');
      return JSON.stringify(good);
    });
  });

  it('refuses stale material and adverse or malformed verdicts', async () => {
    const digest = assessmentMaterialDigest(assessment);
    await expect(
      reviewAssessmentDraft(
        { ...binding, formativeRevision: 'stale' },
        { material: assessment, digest },
        async () => JSON.stringify(good)
      )
    ).rejects.toThrow(/source or material changed/);
    await expect(
      reviewAssessmentDraft(binding, { material: assessment, digest }, async () =>
        JSON.stringify({ ...good, correct: false })
      )
    ).rejects.toThrow(/independent review/);
    await expect(
      reviewAssessmentDraft(binding, { material: assessment, digest }, async () =>
        JSON.stringify({ ...good, issues: ['Ambiguous answer'] })
      )
    ).rejects.toThrow(/independent review/);
    await expect(
      reviewAssessmentDraft(binding, { material: assessment, digest }, async () => '{}')
    ).rejects.toThrow();
    const incomplete = { ...assessment, sections: assessment.sections.slice(0, -1) };
    await expect(
      reviewAssessmentDraft(
        binding,
        { material: incomplete, digest: assessmentMaterialDigest(incomplete) },
        async () => JSON.stringify(good)
      )
    ).rejects.toThrow(/incomplete/);
    await expect(
      reviewAssessmentDraft(binding, { material: assessment, digest: 'stale' }, async () =>
        JSON.stringify(good)
      )
    ).rejects.toThrow(/source or material changed/);
  });

  it('rejects a review that finds a held-out answer disclosed in prior teaching', async () => {
    const revealedSource = {
      ...source,
      teaching: {
        ...source.teaching,
        workedExamples: source.teaching.workedExamples.map((example, index) =>
          index === 0 ? { ...example, explanation: 'The assessment answer is b.' } : example
        ),
      },
    };
    await expect(
      reviewAssessmentDraft(
        { ...binding, source: revealedSource },
        { material: assessment, digest: assessmentMaterialDigest(assessment) },
        async (request) => {
          expect(request.system).toContain('formative teaching');
          expect(request.system).toContain('prerequisite explanations and examples');
          expect(request.payload).toContain('The assessment answer is b.');
          return JSON.stringify({ ...good, answersConcealed: false, issues: ['Answer revealed'] });
        }
      )
    ).rejects.toThrow(/independent review/);
  });

  it('reviews prior exposed tasks for semantic repetition without prior private grading data', async () => {
    const priorAssessments = [
      {
        assessmentId: 'prior-private-id',
        classAttempt: 1,
        assessmentAttempt: 1,
        submissionId: 'prior-submission',
        requestDigest: 'a'.repeat(64),
        operationId: 'prior-operation',
        fingerprint: 'prior-fingerprint',
        tasks: [
          {
            id: 'seen-task',
            skill: 'GRAMMAR' as const,
            task: 'Pide agua',
            options: ['A', 'B', 'C', 'D'],
          },
        ],
      },
    ];
    await expect(
      reviewAssessmentDraft(
        binding,
        { material: assessment, digest: assessmentMaterialDigest(assessment), priorAssessments },
        async (request) => {
          expect(request.system).toContain('every prior assessment task');
          expect(JSON.parse(request.payload).priorTasks).toEqual([priorAssessments[0].tasks]);
          expect(request.payload).not.toContain('prior-fingerprint');
          expect(request.payload).not.toContain('prior-private-id');
          return JSON.stringify({ ...good, independent: false, issues: ['Repeated scenario'] });
        }
      )
    ).rejects.toThrow(/independent review/);
  });
});
describe('assessment section authoring', () => {
  it('requires explicit evidence modalities when authoring version 2 speaking tasks', async () => {
    const requirement = requirements.skills.SPEAKING;
    if (requirement.state !== 'REQUIRED') throw new Error('Speaking fixture must be required');
    const input = {
      source,
      prerequisite: null,
      requirements,
      skill: 'SPEAKING' as const,
      materialVersion: 2 as const,
    };
    const task = {
      task: 'Saluda',
      mode: 'COMMUNICATIVE',
      translation: 'Hola',
      rubric: 'Conveys a greeting',
      guidance: 'Saluda',
      criteria: [{ id: 'meaning', description: 'Conveys a greeting', modality: 'TRANSCRIPT' }],
    };
    const result = await authorAssessmentSection(input, async (request) => {
      expect(request.system).toContain('pronunciation, accent, articulation');
      expect(JSON.stringify(request.schema)).toContain('ACOUSTIC');
      return JSON.stringify({
        skill: 'SPEAKING',
        items: Array.from({ length: requirement.expectedCount }, () => task),
      });
    });
    expect(result.items).toHaveLength(requirement.expectedCount);
    await expect(
      authorAssessmentSection(input, async () =>
        JSON.stringify({
          skill: 'SPEAKING',
          items: Array.from({ length: requirement.expectedCount }, () => ({
            ...task,
            criteria: undefined,
          })),
        })
      )
    ).rejects.toThrow();
  });
  it('requests a private held-out exercise set with the exact required count', async () => {
    const requests: string[] = [];
    const result = await authorAssessmentSection(
      { source, prerequisite: null, requirements, skill: 'GRAMMAR' },
      async (request) => {
        requests.push(request.payload);
        return JSON.stringify({
          skill: 'GRAMMAR',
          items: Array.from({ length: grammarRequirement.expectedCount }, () => question),
        });
      }
    );
    expect(result.skill).toBe('GRAMMAR');
    expect(result.items).toHaveLength(grammarRequirement.expectedCount);
    expect(JSON.parse(requests[0]!)).toMatchObject({
      skill: 'GRAMMAR',
      count: grammarRequirement.expectedCount,
    });
    expect(JSON.parse(requests[0]!).source.teaching.guidedPractice).not.toHaveProperty('answer');
  });
  it('asks the author to avoid previously exposed assessment tasks', async () => {
    const priorTasks = [[{ skill: 'GRAMMAR' as const, task: 'Previously shown question' }]];
    await authorAssessmentSection(
      { source, prerequisite: null, requirements, skill: 'GRAMMAR', priorTasks },
      async (request) => {
        expect(request.system).toContain('prior assessment tasks');
        expect(JSON.parse(request.payload)).toMatchObject({ priorTasks });
        return JSON.stringify({
          skill: 'GRAMMAR',
          items: Array.from({ length: grammarRequirement.expectedCount }, () => question),
        });
      }
    );
  });
  it('rejects an oversized prior assessment history before generation', async () => {
    let called = false;
    await expect(
      authorAssessmentSection(
        {
          source,
          prerequisite: null,
          requirements,
          skill: 'GRAMMAR',
          priorTasks: [[{ skill: 'GRAMMAR', task: 'x'.repeat(32_000) }]],
        },
        async () => {
          called = true;
          return '';
        }
      )
    ).rejects.toThrow(/too large/);
    expect(called).toBe(false);
  });

  it('rejects wrong skill, missing items and invalid answer choices', async () => {
    const input = { source, prerequisite: null, requirements, skill: 'GRAMMAR' as const };
    await expect(
      authorAssessmentSection(input, async () =>
        JSON.stringify({ skill: 'READING', passage: 'Text', items: [] })
      )
    ).rejects.toThrow(/required skill/);
    await expect(
      authorAssessmentSection(input, async () => JSON.stringify({ skill: 'GRAMMAR', items: [] }))
    ).rejects.toThrow(/exercise count/);
    await expect(
      authorAssessmentSection(input, async () =>
        JSON.stringify({
          skill: 'GRAMMAR',
          items: [{ ...question, options: ['a', 'A', 'c', 'd'] }],
        })
      )
    ).rejects.toThrow();
  });

  it('rejects a changed language before calling the provider', async () => {
    let called = false;
    await expect(
      authorAssessmentSection(
        {
          source,
          prerequisite: null,
          requirements: { ...requirements, targetLang: 'de' },
          skill: 'GRAMMAR',
        },
        async () => {
          called = true;
          return '';
        }
      )
    ).rejects.toThrow(/requirements changed/);
    expect(called).toBe(false);
  });

  it('uses the supported audio speaker roles for listening drafts', async () => {
    const listening = requirements.skills.LISTENING;
    if (listening.state !== 'REQUIRED') throw new Error('Listening fixture must be required');
    const result = await authorAssessmentSection(
      { source, prerequisite: null, requirements, skill: 'LISTENING' },
      async () =>
        JSON.stringify({
          skill: 'LISTENING',
          turns: [
            { speaker: 'HOST', text: 'Привет' },
            { speaker: 'EXPERT', text: 'Здравствуйте' },
          ],
          items: Array.from({ length: listening.expectedCount }, () => question),
        })
    );
    expect(result.skill === 'LISTENING' && result.turns[1]?.speaker).toBe('EXPERT');
  });
});
