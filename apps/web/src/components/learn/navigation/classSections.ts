import type { ClassData, ClassSection } from '../classTypes';

const SKILL_ORDER: Record<string, number> = {
  GRAMMAR: 0,
  READING: 1,
  LISTENING: 2,
  SPEAKING: 3,
  WRITING: 4,
};

export function orderSections(sections: ClassSection[]): ClassSection[] {
  return [...sections].sort((a, b) => (SKILL_ORDER[a.skill] ?? 99) - (SKILL_ORDER[b.skill] ?? 99));
}

export function isClassPresentationStillRendering(cls: ClassData): boolean {
  const listening = cls.sections.find((section) => section.skill === 'LISTENING');
  const episode = listening?.episode;
  return Boolean(
    episode && !episode.audioUrl && episode.status !== 'READY' && episode.status !== 'FAILED'
  );
}
