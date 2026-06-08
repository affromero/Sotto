import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/qr', () => ({
  generateQrDataUrl: vi.fn(async (text: string) => `data:image/png;base64,QR(${text})`),
}));

import { buildClassDocument, type BuildClassDocumentInput } from '@/lib/class-document';

const INPUT: BuildClassDocumentInput = {
  id: 'class-1',
  nativeLang: 'en',
  targetLang: 'de',
  lesson: { title: 'Greetings', level: 'A1', objective: 'Greet people' },
  sections: [
    {
      id: 'sec-grammar',
      skill: 'GRAMMAR',
      questions: [
        { id: 'q1', order: 1, question: 'Wie ___ du?', options: ['heißt', 'heißen', 'heiße', 'heißis'], passageRef: null, correctIndex: 0, explanation: 'du -> heißt' },
      ],
      prompts: [],
    },
    {
      id: 'sec-speaking',
      skill: 'SPEAKING',
      questions: [],
      prompts: [{ id: 'p1', order: 1, targetPhrase: 'Guten Tag', translation: 'Good day', ipa: 'ˈɡuːtn̩ taːk' }],
    },
  ],
};

describe('buildClassDocument', () => {
  it('strips correctIndex/explanation in the learner variant', async () => {
    const doc = await buildClassDocument(INPUT, { isAnswerKey: false, appBaseUrl: 'https://app' });

    expect(doc.isAnswerKey).toBe(false);
    const q = doc.sections[0].questions[0];
    expect(q).not.toHaveProperty('correctIndex');
    expect(q).not.toHaveProperty('explanation');
    expect(q.options).toHaveLength(4);
  });

  it('keeps correctIndex/explanation in the answer-key variant', async () => {
    const doc = await buildClassDocument(INPUT, { isAnswerKey: true, appBaseUrl: 'https://app' });

    expect(doc.isAnswerKey).toBe(true);
    const q = doc.sections[0].questions[0];
    expect(q.correctIndex).toBe(0);
    expect(q.explanation).toBe('du -> heißt');
  });

  it('builds a deep link + QR for app-linked skills (speaking/listening)', async () => {
    const doc = await buildClassDocument(INPUT, { isAnswerKey: false, appBaseUrl: 'https://app' });

    const speaking = doc.sections.find((s) => s.skill === 'SPEAKING')!;
    expect(speaking.appLink).toBe('https://app/classes/class-1?section=sec-speaking');
    expect(speaking.qrDataUrl).toContain('QR(https://app/classes/class-1?section=sec-speaking)');
    expect(speaking.prompts[0].targetPhrase).toBe('Guten Tag');
  });

  it('does not build a QR for non-app skills (grammar)', async () => {
    const doc = await buildClassDocument(INPUT, { isAnswerKey: false, appBaseUrl: 'https://app' });

    const grammar = doc.sections.find((s) => s.skill === 'GRAMMAR')!;
    expect(grammar.appLink).toBeNull();
    expect(grammar.qrDataUrl).toBeNull();
  });

  it('skips QR generation entirely when no appBaseUrl is provided', async () => {
    const doc = await buildClassDocument(INPUT, { isAnswerKey: false });

    expect(doc.sections.every((s) => s.qrDataUrl === null && s.appLink === null)).toBe(true);
  });

  it('carries lesson metadata + skill titles', async () => {
    const doc = await buildClassDocument(INPUT, { isAnswerKey: false });

    expect(doc.title).toBe('Greetings');
    expect(doc.level).toBe('A1');
    expect(doc.targetLang).toBe('de');
    expect(doc.sections.find((s) => s.skill === 'GRAMMAR')!.title).toBe('Grammar');
    expect(doc.sections.find((s) => s.skill === 'SPEAKING')!.title).toBe('Speaking');
  });
});
