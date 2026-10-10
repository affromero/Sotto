import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIOptions, ChatMessage } from '@/lib/providers/ai';

const generateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse }),
}));

import { formatSourceBlock, generateScript } from '@/lib/script-generator';

const source = 'Anna hat gestern ihre Schwester besucht.';
const topic = 'Describe completed activities using the conversational past.';
const spoken = 'Anna hat gestern ihre Schwester [V1:besucht].';
const params = {
  provider: 'anthropic',
  model: 'fixture',
  topic,
  depth: 'standard',
  audienceLevel: 'A2',
  focusAreas: [],
  tone: 'casual',
  durationTarget: 4,
  targetLanguage: 'de',
  languageMode: 'full_immersion',
  mustIncludeVocabulary: [{ word: 'besuchen', translation: 'to visit' }],
};

describe('listening authoring context', () => {
  beforeEach(() => {
    generateResponse.mockReset();
    generateResponse.mockResolvedValue({
      content: JSON.stringify({
        turns: [{ speaker: 'HOST', text: spoken }],
        soundCues: [],
        references: [],
        vocabulary: [{ number: 1, word: 'besuchen', translation: 'to visit' }],
      }),
      inputTokens: 1,
      outputTokens: 1,
    });
  });

  it.each([true, false])(
    'preserves source and output while scoping conversational roles and objective to learning %s',
    async (forLearning) => {
      const result = await generateScript({ ...params, forLearning, sourceContent: source });
      const [system, messages] = generateResponse.mock.calls[0] as [
        string,
        ChatMessage[],
        AIOptions,
      ];
      const request = messages[0].content as string;
      expect(request).toContain(formatSourceBlock(source));
      expect(request).toContain(`Depth: ${params.depth}`);
      expect(system).toContain('- besuchen — to visit');
      expect(result.turns).toEqual([{ speaker: 'HOST', text: spoken }]);
      expect(result.vocabulary).toMatchObject([{ number: 1, word: 'besuchen' }]);
      if (forLearning) {
        expect(request).toContain(`Communicative objective: ${topic}`);
        expect(request).toContain('within a concrete situation the speakers experience');
        expect(system).toContain('HOST: An ordinary participant in the situation');
        expect(system).toContain('EXPERT: An ordinary conversation partner in the same situation');
        expect(system).toContain("at the learner's CEFR level");
        expect(system).toContain('Use these targets naturally in the concrete situation');
        expect(system).toContain('between 525 and 675 words (600 ideal)');
        expect(system).toContain('keep the information load low throughout the passage');
        expect(system).toContain('Make changes of person, place and time explicit');
        expect(system).toContain('excluding speaker labels and nonspoken metadata');
        expect(system).not.toContain('Explains complex topics');
      } else {
        expect(request).toBe(`Topic: ${topic}\nDepth: standard\n\n${formatSourceBlock(source)}`);
        expect(system).toContain('HOST: Warm, curious, asks great questions');
        expect(system).toContain('EXPERT: Knowledgeable, vivid storyteller');
        expect(system).toContain('Explains complex topics');
        expect(system).toContain('Prioritize these targets for anticipation and recall');
        expect(system).not.toContain('keep the information load low throughout the passage');
      }
    }
  );

  it.each(['vocabulary_intro', 'conversational_mix', 'full_immersion'])(
    'retains vocabulary identities and the intended learning practice in %s mode',
    async (languageMode) => {
      const result = await generateScript({ ...params, forLearning: true, languageMode });
      const [system, messages] = generateResponse.mock.calls[0] as [
        string,
        ChatMessage[],
        AIOptions,
      ];
      expect(messages[0].content).toContain(`Communicative objective: ${topic}`);
      expect(system).toContain('- besuchen — to visit');
      expect(result.turns[0].text).toBe(spoken);
      expect(result.vocabulary[0].word).toBe('besuchen');
      if (languageMode === 'full_immersion') {
        expect(system).toContain('Use these targets naturally in the concrete situation');
        expect(system).not.toContain('Prioritize these targets for anticipation and recall');
      } else {
        expect(system).toContain('Prioritize these targets for anticipation and recall');
        expect(system).toMatch(/ANTICIPATION technique|Use anticipation prompts/);
      }
    }
  );

  it.each([true, false])('preserves custom solo speakers in learning %s', async (forLearning) => {
    generateResponse.mockResolvedValue({
      content: JSON.stringify({
        turns: [{ speaker: 'NARRATOR', text: spoken }],
        soundCues: [],
        references: [],
        vocabulary: [{ number: 1, word: 'besuchen', translation: 'to visit' }],
      }),
    });
    const result = await generateScript({
      ...params,
      forLearning,
      speakers: [{ name: 'NARRATOR', description: 'A calm personal storyteller.' }],
    });
    const [system] = generateResponse.mock.calls[0] as [string];
    expect(system).toContain('NARRATOR: A calm personal storyteller.');
    expect(system).not.toContain('HOST: An ordinary participant');
    expect(system).not.toContain('EXPERT: An ordinary conversation partner');
    expect(result.turns).toEqual([{ speaker: 'NARRATOR', text: spoken }]);
  });

  it('preserves the communicative objective and source during a bounded script correction', async () => {
    const result = await generateScript({
      ...params,
      forLearning: true,
      sourceContent: source,
      learningRepair: {
        kind: 'script_protocol',
        candidate: '{"turns":[{"speaker":"HOST","text":"[V99:besucht]"}]}',
        issues: [{ code: 'script_vocabulary_missing_identity' }],
      },
    });
    const [system, messages] = generateResponse.mock.calls[0] as [string, ChatMessage[]];
    expect(messages[0].content).toContain(`Communicative objective: ${topic}`);
    expect(messages[0].content).toContain(formatSourceBlock(source));
    expect(messages[0].content).toContain('script_vocabulary_missing_identity');
    expect(system).toContain('- besuchen — to visit');
    expect(result.turns).toEqual([{ speaker: 'HOST', text: spoken }]);
    expect(result.vocabulary[0].word).toBe('besuchen');
  });
});
