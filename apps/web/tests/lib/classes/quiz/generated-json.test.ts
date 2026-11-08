import { describe, expect, it } from 'vitest';
import { parseGeneratedQuestions } from '@/lib/classes/quiz/generated-json';

describe('generated quiz JSON', () => {
  it('reads a fenced object with brackets and escaped quotes inside a string', () => {
    const generated = { passage: 'A "quoted }" example', questions: [{ question: '¿Qué [es]?' }] };
    expect(
      parseGeneratedQuestions(`Before\n\`\`\`json\n${JSON.stringify(generated)}\n\`\`\`\nAfter`)
    ).toEqual(generated);
  });
});
