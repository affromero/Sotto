import { describe, expect, it } from 'vitest';
import { buildTeachingSourceParts } from '@/lib/classes/quality/teaching-source/protocol';
import { buildTeachingCriticJsonSchema } from '@/lib/classes/quality/teaching-quality';
import { parseTeachingCriticResponse } from '@/lib/classes/quality/teaching-review-protocol';
import { withReadingSupportFixture } from './reading-support-fixture';

const content = {
  question: 'Was liest Mila?',
  options: ['Ein Buch.', 'Eine Zeitung.', 'Eine Karte.', 'Einen Brief.'],
  correctIndex: 0,
  explanation: 'Mila liest ein Buch.',
  passageText: 'Mila sitzt im Garten und liest ein Buch.',
};
const messages = [
  {
    content: JSON.stringify({
      items: [{ index: 0, content, sourceParts: buildTeachingSourceParts(content) }],
    }),
  },
];
const options = { jsonSchema: buildTeachingCriticJsonSchema([content], false, true) };

describe('declared reading provider fixtures', () => {
  it('supplies complete current source addresses to the actual reading parser', () => {
    const response = withReadingSupportFixture(messages, options, {
      content: JSON.stringify({ items: [{ index: 0, findings: [] }] }),
    });
    const parsed = parseTeachingCriticResponse(response.content, [content], true);
    expect(parsed.items[0].answerSupport?.options[0].status).toBe('supported');
    expect(parsed.items[0].answerSupport?.constraints).toHaveLength(6);
  });

  it('preserves explicit negative or malformed witnesses rather than repairing the fixture', () => {
    const response = {
      content: JSON.stringify({
        items: [{ index: 0, findings: [], answerSupport: { invalid: true } }],
      }),
    };
    expect(withReadingSupportFixture(messages, options, response)).toEqual(response);
    expect(() => parseTeachingCriticResponse(response.content, [content], true)).toThrow();
  });

  it('preserves nonreading and malformed provider responses', () => {
    const response = { content: '{' };
    expect(withReadingSupportFixture(messages, undefined, response)).toBe(response);
    expect(withReadingSupportFixture(messages, options, response)).toBe(response);
  });
});
