import { describe, expect, it } from 'vitest';
import {
  classQuestionMaterialSchema,
  savedClassQuestionMaterialSchema,
} from '@/lib/learning/classes/formative/class-material';

describe('saved class questions', () => {
  it('preserves valid older choice counts without changing publication requirements', () => {
    const question = {
      question: 'Elige una respuesta.',
      options: ['Sí', 'No'],
      correctIndex: 0,
      explanation: 'Es una respuesta afirmativa.',
    };
    expect(savedClassQuestionMaterialSchema.safeParse(question).success).toBe(true);
    expect(classQuestionMaterialSchema.safeParse(question).success).toBe(false);
    expect(
      classQuestionMaterialSchema.safeParse({
        ...question,
        options: ['Sí', 'No', 'Quizá', 'Nunca'],
      }).success
    ).toBe(true);
    expect(
      savedClassQuestionMaterialSchema.safeParse({ ...question, correctIndex: 2 }).success
    ).toBe(false);
  });
});
