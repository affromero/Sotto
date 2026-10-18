import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptTurn } from '@/lib/script-generator';

const generateResponse = vi.fn();
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse }),
}));

import { generateScript } from '@/lib/script-generator';
import {
  ScriptOutputProtocolError,
  scriptOutputProtocolFailure,
} from '@/lib/learning/script/output-protocol';

const params = {
  provider: 'anthropic',
  model: 'fixture',
  topic: 'Describe a visit',
  depth: 'standard',
  audienceLevel: 'B2',
  focusAreas: [],
  tone: 'casual',
  durationTarget: 4,
  forLearning: true,
  targetLanguage: 'de',
};

function respond(turns: ScriptTurn[], extra: Record<string, unknown> = {}) {
  const content = JSON.stringify({ turns, soundCues: [], references: [], ...extra });
  generateResponse.mockResolvedValue({ content, model: 'fixture' });
  return content;
}

describe('listening dialogue turns', () => {
  beforeEach(() => generateResponse.mockReset());

  it('keeps bounded speaker turns and vocabulary markers exactly as written', async () => {
    const turns = [
      { speaker: 'HOST', text: '[pause] ' + '[V1:Besuch] '.repeat(60).trim(), direction: 'warm' },
      { speaker: 'EXPERT', text: 'Wie war der Besuch?' },
    ];
    respond(turns, { vocabulary: [{ number: 1, word: 'Besuch', translation: 'visit' }] });

    const result = await generateScript(params);

    expect(result.turns).toEqual(turns);
    expect(result.markdown).toContain(turns[0].text);
    expect(result.vocabulary).toMatchObject([{ number: 1, word: 'Besuch' }]);
  });

  it.each([
    {
      name: 'a long unbroken speaker clip',
      turns: [
        { speaker: 'HOST', text: 'Besuch '.repeat(61) },
        { speaker: 'EXPERT', text: 'Wie war es?' },
      ],
      code: 'script_dialogue_turn_too_long',
    },
    {
      name: 'a monologue when multiple speakers were supplied',
      turns: [{ speaker: 'HOST', text: 'Ich habe Anna besucht.' }],
      code: 'script_dialogue_missing_exchange',
    },
    {
      name: 'an unconfigured speaker',
      turns: [
        { speaker: 'HOST', text: 'Ich habe Anna besucht.' },
        { speaker: 'NARRATOR', text: 'Wie war es?' },
      ],
      code: 'script_dialogue_unknown_speaker',
    },
    {
      name: 'multiple speaker labels inside one audio clip',
      turns: [
        { speaker: 'HOST', text: 'Hallo!\nEXPERT: Wie war der Besuch?' },
        { speaker: 'EXPERT', text: 'Er war schön.' },
      ],
      code: 'script_dialogue_embedded_speaker',
    },
    {
      name: 'an inline speaker change inside one audio clip',
      turns: [
        { speaker: 'HOST', text: 'Hallo! EXPERT: Wie war der Besuch?' },
        { speaker: 'EXPERT', text: 'Er war schön.' },
      ],
      code: 'script_dialogue_embedded_speaker',
    },
  ])('rejects $name with bounded authentic correction evidence', async ({ turns, code }) => {
    const candidate = respond(turns);
    const error = await generateScript(params).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ScriptOutputProtocolError);
    expect(scriptOutputProtocolFailure(error)).toEqual({ candidate, issues: [{ code }] });
    expect(
      scriptOutputProtocolFailure(new ScriptOutputProtocolError('script_dialogue_turn_too_long'))
    ).toBeUndefined();
  });

  it('counts spoken words in languages without space-separated words', async () => {
    respond([
      { speaker: 'HOST', text: '今日は学校に行きます。'.repeat(30) },
      { speaker: 'EXPERT', text: '誰と行きますか。' },
    ]);

    await expect(generateScript({ ...params, targetLanguage: 'ja' })).rejects.toThrow(
      ScriptOutputProtocolError
    );
  });

  it('recognizes a supplied speaker label containing regular-expression punctuation', async () => {
    respond([
      { speaker: 'HOST', text: 'Hallo! Dr. [M]: Wie war der Besuch?' },
      { speaker: 'Dr. [M]', text: 'Er war schön.' },
    ]);

    await expect(
      generateScript({
        ...params,
        speakers: [
          { name: 'HOST', description: 'The host.' },
          { name: 'Dr. [M]', description: 'The conversation partner.' },
        ],
      })
    ).rejects.toThrow(ScriptOutputProtocolError);
  });

  it('retains an oversized rejected candidate as omitted rather than replaying unbounded text', async () => {
    respond([
      { speaker: 'HOST', text: 'Besuch '.repeat(6000) },
      { speaker: 'EXPERT', text: 'Wie war es?' },
    ]);
    const error = await generateScript(params).catch((failure: unknown) => failure);

    expect(scriptOutputProtocolFailure(error)).toEqual({
      candidate: null,
      issues: [{ code: 'script_dialogue_turn_too_long' }],
    });
  });

  it('allows an explicitly requested solo lesson to retain its narration', async () => {
    const turns = [{ speaker: 'NARRATOR', text: 'Besuch '.repeat(100) }];
    respond(turns);

    const result = await generateScript({
      ...params,
      speakers: [{ name: 'NARRATOR', description: 'A solo narrator.' }],
    });

    expect(result.turns).toEqual(turns);
  });

  it('carries dialogue correction requirements and the original rejected output to the provider', async () => {
    const candidate = respond([{ speaker: 'HOST', text: 'Besuch '.repeat(61) }]);
    const error = await generateScript(params).catch((failure: unknown) => failure);
    const failure = scriptOutputProtocolFailure(error)!;
    const turns = [
      { speaker: 'HOST', text: 'Ich habe Anna besucht.' },
      { speaker: 'EXPERT', text: 'Wie war der Besuch?' },
    ];
    respond(turns);

    const result = await generateScript({
      ...params,
      learningRepair: { kind: 'script_protocol', candidate, issues: failure.issues },
    });

    expect(result.turns).toEqual(turns);
    const [system, messages] = generateResponse.mock.calls.at(-1)!;
    expect(system).toContain('at most 60 spoken words');
    expect(messages[0].content).toContain(JSON.stringify(candidate));
    expect(messages[0].content).toContain('script_dialogue_turn_too_long');
    expect(messages[0].content).toContain('speaker attribution and dialogue turn limits');
  });
});
