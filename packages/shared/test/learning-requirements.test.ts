import { describe, expect, it } from 'vitest';
import {
  createSkillRequirements,
  requiredLearningSkills,
  skillRequirementsSchema,
} from '../src/learning-requirements';

const context = {
  scope: 'FULL' as const,
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2' as const,
};

describe('complete learning requirements', () => {
  it.each([
    [null, null, ['GRAMMAR', 'READING', 'WRITING']],
    ['cartesia', null, ['GRAMMAR', 'READING', 'LISTENING', 'WRITING']],
    [null, 'openai', ['GRAMMAR', 'READING', 'SPEAKING', 'WRITING']],
    ['local', 'local', ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']],
  ])(
    'requires every skill supported by TTS %s and STT %s',
    (ttsProvider, sttProvider, expected) => {
      const requirements = createSkillRequirements({ ...context, ttsProvider, sttProvider });
      expect(requiredLearningSkills(requirements)).toEqual(expected);
      expect(requirements.referenceAudioRequired).toBe(
        ttsProvider !== null && sttProvider !== null
      );
    }
  );

  it('keeps explicitly requested grammar practice focused', () => {
    const requirements = createSkillRequirements({
      ...context,
      scope: 'GRAMMAR',
      ttsProvider: 'cartesia',
      sttProvider: 'openai',
    });
    expect(requiredLearningSkills(requirements)).toEqual(['GRAMMAR']);
    expect(requirements.referenceAudioRequired).toBe(false);
  });

  it('rejects a waived writing requirement even when audio is absent', () => {
    const requirements = createSkillRequirements({
      ...context,
      ttsProvider: null,
      sttProvider: null,
    });
    expect(
      skillRequirementsSchema.safeParse({
        ...requirements,
        skills: {
          ...requirements.skills,
          WRITING: { state: 'EXEMPT_NO_PROVIDER', reason: 'NO_TTS_PROVIDER' },
        },
      }).success
    ).toBe(false);
  });

  it('rejects an exemption for listening when TTS access was captured', () => {
    const requirements = createSkillRequirements({
      ...context,
      ttsProvider: 'cartesia',
      sttProvider: 'openai',
    });
    expect(
      skillRequirementsSchema.safeParse({
        ...requirements,
        skills: {
          ...requirements.skills,
          LISTENING: { state: 'EXEMPT_NO_PROVIDER', reason: 'NO_TTS_PROVIDER' },
        },
      }).success
    ).toBe(false);
  });

  it('rejects a partial section disguised as complete material', () => {
    const requirements = createSkillRequirements({
      ...context,
      ttsProvider: null,
      sttProvider: null,
    });
    expect(
      skillRequirementsSchema.safeParse({
        ...requirements,
        skills: { ...requirements.skills, WRITING: { state: 'REQUIRED', expectedCount: 0 } },
      }).success
    ).toBe(false);
  });
});
