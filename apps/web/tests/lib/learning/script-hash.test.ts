import { describe, expect, it } from 'vitest';
import { learningScriptHash } from '@/lib/learning/script-hash';

describe('learning script identity', () => {
  it('retains identity when database JSON object keys are reordered', () => {
    expect(learningScriptHash([{ speaker: 'Ana', text: 'Hola.', direction: 'quiet' }])).toBe(
      learningScriptHash([{ direction: 'quiet', text: 'Hola.', speaker: 'Ana' }])
    );
  });
  it.each([
    { speaker: 'Ana', text: 'Adiós.', direction: 'quiet' },
    { speaker: 'Luis', text: 'Hola.', direction: 'quiet' },
    { speaker: 'Ana', text: 'Hola.', direction: 'excited' },
  ])('invalidates the reviewed identity when speech content changes: %j', (turn) => {
    expect(learningScriptHash([turn])).not.toBe(
      learningScriptHash([{ speaker: 'Ana', text: 'Hola.', direction: 'quiet' }])
    );
  });
  it('rejects an empty or unspoken script', () => {
    expect(() => learningScriptHash([])).toThrow();
    expect(() => learningScriptHash([{ speaker: 'Ana', text: '  ' }])).toThrow();
  });
});
