import { describe, expect, it } from 'vitest';
import {
  vocabularyAnswerMatches,
  publicVocabularyStudy,
  type VocabularyStudyState,
} from '@/lib/vocabulary/study-state';

const card = {
  id: '00000000-0000-4000-8000-000000000002',
  wordId: 'word-1',
  lemma: 'Bahnhof',
  meaning: 'station',
  acceptedMeanings: ['train station'],
  response: null,
  listeningPresentedAt: null,
};
const state: VocabularyStudyState = {
  version: 1,
  normalization: 'unicode-v1',
  requestId: '00000000-0000-4000-8000-000000000001',
  courseId: 'course-1',
  userId: 'learner-1',
  mode: 'MEANING_RECALL',
  support: 'MEANING_RECALL',
  nativeLang: 'en',
  targetLang: 'de',
  requestedWordIds: [],
  cards: [card],
};
const session = {
  id: state.requestId,
  progressRevision: 0,
  writingDrafts: null,
  submissionResult: null,
};

describe('dictionary recall answers', () => {
  it('accepts explicit native meanings with normalized spaces and case', () => {
    expect(vocabularyAnswerMatches(card, 'MEANING_RECALL', '  TRAIN   station ', 'en')).toBe(true);
    expect(vocabularyAnswerMatches(card, 'MEANING_RECALL', 'platform', 'en')).toBe(false);
  });

  it('never manufactures aliases by splitting a dictionary gloss', () => {
    const combined = { ...card, meaning: 'station; platform', acceptedMeanings: [] };
    expect(vocabularyAnswerMatches(combined, 'MEANING_RECALL', 'platform', 'en')).toBe(false);
    expect(vocabularyAnswerMatches(combined, 'MEANING_RECALL', 'station; platform', 'en')).toBe(
      true
    );
  });

  it('preserves dictionary capitals and accents in word recall', () => {
    expect(vocabularyAnswerMatches(card, 'WORD_RECALL', 'Bahnhof', 'en')).toBe(true);
    expect(vocabularyAnswerMatches(card, 'WORD_RECALL', 'bahnhof', 'en')).toBe(false);
    const accented = { ...card, lemma: 'März' };
    expect(vocabularyAnswerMatches(accented, 'WORD_RECALL', 'Ma\u0308rz', 'en')).toBe(true);
    expect(vocabularyAnswerMatches(accented, 'WORD_RECALL', 'Marz', 'en')).toBe(false);
  });
});

describe('private study snapshots', () => {
  it('keeps accepted meanings and dictionary keys private before a meaning answer', () => {
    const published = publicVocabularyStudy(state, session);
    expect(published.cards).toEqual([{ id: card.id, prompt: 'Bahnhof', feedback: null }]);
    expect(JSON.stringify(published)).not.toContain('train station');
    expect(JSON.stringify(published)).not.toContain('word-1');
  });

  it('does not reveal the target spelling or meaning in a listening prompt', () => {
    const published = publicVocabularyStudy({ ...state, mode: 'LISTENING_RECALL' }, session);
    expect(JSON.stringify(published)).not.toContain('Bahnhof');
    expect(JSON.stringify(published)).not.toContain('station');
  });

  it('publishes feedback only after the server records a response', () => {
    const published = publicVocabularyStudy(
      {
        ...state,
        cards: [
          {
            ...card,
            response: {
              outcome: 'ANSWERED',
              answer: 'train station',
              correct: true,
              reviewedAt: '2026-10-20T12:00:00.000Z',
            },
          },
        ],
      },
      session
    );
    expect(published.cards[0]?.feedback).toMatchObject({
      correct: true,
      lemma: 'Bahnhof',
      meaning: 'station',
      acceptedMeanings: ['train station'],
    });
  });
});
