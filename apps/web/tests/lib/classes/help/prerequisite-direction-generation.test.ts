import { describe, expect, it } from 'vitest';
import { prerequisitePublicSourceSchema } from '@/lib/classes/help/content/prerequisite-source';
import { generatePrerequisiteDirections } from '@/lib/classes/help/content/prerequisite-direction-generation';
import { sampleTeaching } from '../../../helpers/learning/class-teaching';

function source() {
  return prerequisitePublicSourceSchema.parse({
    course: { nativeLang: 'es', targetLang: 'ru' },
    lesson: { level: 'A1', title: 'Primeras palabras', objective: 'Saludar' },
    teaching: {
      ...sampleTeaching,
      guidedPractice: { prompt: 'Pide té.', hint: 'Usa una expresión cortés.' },
    },
    sections: [
      {
        id: 'grammar',
        skill: 'GRAMMAR',
        attempt: 1,
        status: 'READY',
        questions: Array.from({ length: 8 }, (_, index) => ({
          id: `q${index}`,
          question:
            index === 0
              ? 'Преврати сообщение после приветствия в вопрос о собеседнике: сохрани лицо и настоящее время (sin añadir «ser»).\nПривет! Ты Павел.'
              : `Elige la forma ${index}.`,
          options: ['PRIVATE_CHOICE_ONE', 'PRIVATE_CHOICE_TWO'],
          passageText: 'PRIVATE_PASSAGE',
        })),
        speaking: [],
        writing: [],
        listening: null,
      },
    ],
  });
}

type Request = Parameters<Parameters<typeof generatePrerequisiteDirections>[1]>[0];
function candidate(request: Request) {
  const payload = JSON.parse(request.payload) as {
    guided: unknown;
    tasks: Array<{ sectionId: string; taskId: string; kind: string }>;
  };
  return {
    guided: payload.guided ? 'Pide la bebida con cortesía.' : null,
    tasks: payload.tasks.map(({ sectionId, taskId, kind }) => ({
      sectionId,
      taskId,
      kind,
      instruction: 'Transforma el mensaje en una pregunta.',
    })),
  };
}
const approved = JSON.stringify({
  faithful: true,
  understandable: true,
  challengePreserved: true,
  answersConcealed: true,
  issues: [],
});

describe('prerequisite direction authoring', () => {
  it('returns a complete set only after both batches are guarded and independently reviewed', async () => {
    const requests: Request[] = [];
    const checked: string[][] = [];
    const result = await generatePrerequisiteDirections(
      source(),
      async (request) => {
        requests.push(request);
        return request.name === 'class_prerequisite_directions'
          ? JSON.stringify(candidate(request))
          : approved;
      },
      async (texts) => {
        checked.push(texts);
      }
    );
    expect(result.tasks).toHaveLength(8);
    expect(result.guided).toBe('Pide la bebida con cortesía.');
    expect(checked.map((items) => items.length)).toEqual([8, 1]);
    expect(requests.map((request) => request.name)).toEqual([
      'class_prerequisite_directions',
      'class_prerequisite_directions_review',
      'class_prerequisite_directions',
      'class_prerequisite_directions_review',
    ]);
    expect(JSON.stringify(requests)).not.toMatch(/PRIVATE_CHOICE|PRIVATE_PASSAGE/);
    expect(requests[0]!.payload).toContain('Преврати сообщение');
    expect(JSON.parse(requests[0]!.payload).guided).toEqual({
      prompt: 'Pide té.',
      hint: 'Usa una expresión cortés.',
    });
    expect(JSON.parse(requests[2]!.payload).guided).toBeNull();
  });

  it('refuses a direction with an unrecognized exercise before review', async () => {
    const requests: Request[] = [];
    await expect(
      generatePrerequisiteDirections(
        source(),
        async (request) => {
          requests.push(request);
          const value = candidate(request);
          value.tasks[0]!.taskId = 'another-class';
          return JSON.stringify(value);
        },
        async () => undefined
      )
    ).rejects.toThrow('current exercises');
    expect(requests.map((request) => request.name)).toEqual(['class_prerequisite_directions']);
  });

  it('does not send a locally rejected answer to the reviewer', async () => {
    const requests: Request[] = [];
    await expect(
      generatePrerequisiteDirections(
        source(),
        async (request) => {
          requests.push(request);
          return JSON.stringify(candidate(request));
        },
        async () => {
          throw new Error('disclosure refused');
        }
      )
    ).rejects.toThrow('disclosure refused');
    expect(requests.map((request) => request.name)).toEqual(['class_prerequisite_directions']);
  });

  it('does not return partial directions when a later review rejects them', async () => {
    let reviews = 0;
    await expect(
      generatePrerequisiteDirections(
        source(),
        async (request) => {
          if (request.name === 'class_prerequisite_directions')
            return JSON.stringify(candidate(request));
          return ++reviews === 1
            ? approved
            : JSON.stringify({
                faithful: true,
                understandable: false,
                challengePreserved: true,
                answersConcealed: true,
                issues: [],
              });
        },
        async () => undefined
      )
    ).rejects.toThrow('did not pass independent review');
    expect(reviews).toBe(2);
  });

  it('rejects unmoderatable source context before making any model request', async () => {
    const captured = source();
    captured.lesson.title = 'a'.repeat(32_000);
    const requests: Request[] = [];
    await expect(
      generatePrerequisiteDirections(
        captured,
        async (request) => {
          requests.push(request);
          return JSON.stringify(candidate(request));
        },
        async () => undefined
      )
    ).rejects.toThrow('too large to review safely');
    expect(requests).toEqual([]);
  });
});
