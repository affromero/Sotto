import { describe, expect, it, type Mock } from 'vitest';
import { generateSectionQuestions, type SectionGenParams } from '@/lib/class-generation';
import { QuizRetryRepetitionError } from '@/lib/classes/quiz/retry';
import { GENERATED_PASSAGE, SAMPLE_QUESTIONS } from '../../helpers/runtime/section-generation';

export function registerQuizRetryTests(base: SectionGenParams, author: Mock, teacher: Mock) {
  const retry = {
    previousQuestions: SAMPLE_QUESTIONS,
    missedQuestions: [
      {
        question: SAMPLE_QUESTIONS[0].question,
        selectedAnswer: SAMPLE_QUESTIONS[0].options[1],
        explanation: 'Review the reason for the earlier action.',
      },
    ],
  };
  describe('fresh mastery questions', () => {
    it('checks uniqueness after approved teaching items are retained', async () => {
      const replacement = SAMPLE_QUESTIONS.map((question, index) => ({
        ...question,
        question: index === 1 ? SAMPLE_QUESTIONS[0].question : `New situation ${index}`,
      }));
      author
        .mockResolvedValueOnce({
          content: JSON.stringify({ passage: '', questions: SAMPLE_QUESTIONS }),
          model: 'm',
        })
        .mockResolvedValue({
          content: JSON.stringify({ passage: '', questions: replacement }),
          model: 'm',
        });
      teacher.mockResolvedValueOnce({
        content: JSON.stringify({
          items: SAMPLE_QUESTIONS.map((_, index) => ({
            index,
            acceptable: index === 0,
            issues: index === 0 ? [] : ['unnatural'],
            feedback: index === 0 ? [] : ['The explanation teaches an incorrect collocation.'],
          })),
        }),
        model: 'm',
      });
      await expect(
        generateSectionQuestions({
          ...base,
          skill: 'GRAMMAR',
          retry: {
            previousQuestions: [{ question: 'An older different question', options: ['a', 'b'] }],
            missedQuestions: [],
          },
        })
      ).rejects.toBeInstanceOf(QuizRetryRepetitionError);
    });

    it('rejects previously shown questions even when their choices are reordered', async () => {
      const repeated = SAMPLE_QUESTIONS.map((question) => ({
        ...question,
        options: [...question.options].reverse(),
        correctIndex: question.options.length - 1 - question.correctIndex,
      }));
      author.mockResolvedValue({
        content: JSON.stringify({ passage: GENERATED_PASSAGE, questions: repeated }),
        model: 'm',
      });
      await expect(generateSectionQuestions({ ...base, retry })).rejects.toBeInstanceOf(
        QuizRetryRepetitionError
      );
    });

    it('replaces a repeated candidate with fresh reviewed questions about the missed concepts', async () => {
      const fresh = SAMPLE_QUESTIONS.map((question, index) => ({
        ...question,
        question: `En la nueva situación ${index + 1}, ¿qué ocurre?`,
      }));
      author
        .mockResolvedValueOnce({
          content: JSON.stringify({ passage: GENERATED_PASSAGE, questions: SAMPLE_QUESTIONS }),
          model: 'm',
        })
        .mockResolvedValue({
          content: JSON.stringify({ passage: GENERATED_PASSAGE, questions: fresh }),
          model: 'm',
        });
      const result = await generateSectionQuestions({ ...base, retry });
      expect(result.map((question) => question.question)).toEqual(
        fresh.map((question) => question.question)
      );
      expect(author.mock.calls[0][0]).toContain(retry.missedQuestions[0].explanation);
      expect(author.mock.calls[0][0]).toContain(retry.previousQuestions[0].question);
    });
  });
}
