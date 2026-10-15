import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrammarSection } from '@/components/learn/GrammarSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const questions = Array.from({ length: 5 }, (_, index) => ({
  id: `question-${index}`,
  order: index + 1,
  question: `Complete sentence ${index + 1}.`,
  options: ['habe', 'bin'],
  correctIndex: 0,
  explanation: 'This verb uses haben.',
}));

function renderSection(
  skill: 'GRAMMAR' | 'READING',
  savedAnswers: Record<string, number> = {},
  gate = 70,
  questionSet = questions
) {
  const onRetry = vi.fn();
  render(
    <GrammarSection
      courseId="demo-course"
      sourceId="demo-section"
      skill={skill}
      questions={questionSet}
      savedAnswers={savedAnswers}
      gate={gate}
      nextName="Reading"
      onAnswer={vi.fn()}
      onScore={vi.fn()}
      onContinue={vi.fn()}
      onRetry={onRetry}
    />
  );
  return onRetry;
}

describe('fresh grammar and reading practice', () => {
  it.each(['GRAMMAR', 'READING'] as const)(
    'offers new questions after a below-gate %s result',
    (skill) => {
      const onRetry = renderSection(skill);
      expect(
        screen.queryByRole('button', { name: 'Practise with new questions' })
      ).not.toBeInTheDocument();
      for (let index = 0; index < questions.length; index += 1) {
        fireEvent.click(
          screen.getByRole('button', { name: index < 3 ? 'Option 1: habe' : 'Option 2: bin' })
        );
        fireEvent.click(screen.getByRole('button', { name: index === 4 ? 'See result' : 'Next' }));
      }
      expect(
        screen.getByRole('progressbar', { name: 'Recall: 60% of gate 70%' })
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'More practice needed' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
      expect(screen.queryByText(/graded when you finish/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Practise with new questions' }));
      expect(onRetry).toHaveBeenCalledOnce();
    }
  );

  it('restores a failed saved result without replaying the revealed questions', () => {
    renderSection('GRAMMAR', {
      'question-0': 0,
      'question-1': 0,
      'question-2': 0,
      'question-3': 1,
      'question-4': 1,
    });
    expect(screen.getByRole('button', { name: 'Practise with new questions' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Option 1: habe' })).not.toBeInTheDocument();
  });

  it('keeps the gate closed when the exact score is below a fractional threshold', () => {
    renderSection(
      'GRAMMAR',
      { 'question-0': 0, 'question-1': 0, 'question-2': 0, 'question-3': 1, 'question-4': 1 },
      60.1
    );
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Practise with new questions' })).toBeEnabled();
  });

  it('lets a saved passing result continue without offering replacement questions', () => {
    renderSection('GRAMMAR', Object.fromEntries(questions.map((question) => [question.id, 0])));
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Ready to continue' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Practise with new questions' })
    ).not.toBeInTheDocument();
  });

  it('does not unlock a score rounded up to the displayed gate', () => {
    const nearGateQuestions = Array.from({ length: 23 }, (_, index) => ({
      ...questions[0],
      id: `near-${index}`,
      order: index + 1,
    }));
    renderSection(
      'GRAMMAR',
      Object.fromEntries(
        nearGateQuestions.map((question, index) => [question.id, index < 16 ? 0 : 1])
      ),
      70,
      nearGateQuestions
    );
    expect(
      screen.getByRole('progressbar', { name: 'Recall: 69.5% of gate 70%' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Practise with new questions' })).toBeEnabled();
  });
});
