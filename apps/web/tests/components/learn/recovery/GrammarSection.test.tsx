import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  it('shows every exercise immediately and lets the learner start with the last question', () => {
    renderSection('GRAMMAR');
    for (const question of questions) expect(screen.getByText(question.question)).toBeVisible();
    const last = within(screen.getByRole('region', { name: 'Question 5' }));
    expect(last.queryByText(questions[4].explanation)).not.toBeInTheDocument();
    fireEvent.click(last.getByRole('button', { name: 'Option 1: habe' }));
    expect(last.getByText(questions[4].explanation)).toBeVisible();
    const first = within(screen.getByRole('region', { name: 'Question 1' }));
    expect(first.queryByText(questions[0].explanation)).not.toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Option 1: habe' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
  });

  it('requires the remaining answer even after the score reaches the gate', () => {
    renderSection('GRAMMAR', Object.fromEntries(questions.slice(0, 4).map((q) => [q.id, 0])));
    expect(screen.getByRole('progressbar', { name: 'Recall: 80% of gate 70%' })).toBeVisible();
    const continueButton = screen.getByRole('button', { name: 'Continue · Reading' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Question 5' })).getByRole('button', {
        name: 'Option 2: bin',
      })
    );
    expect(continueButton).toBeEnabled();
    expect(screen.getByText(questions[0].question)).toBeVisible();
  });

  it('rejects saved answers outside their option range', () => {
    renderSection('GRAMMAR', { 'question-0': -1, 'question-1': 99, 'question-2': 0.5 });
    for (let index = 1; index <= 3; index++) {
      expect(
        within(screen.getByRole('region', { name: `Question ${index}` })).getByRole('button', {
          name: 'Option 1: habe',
        })
      ).toBeEnabled();
    }
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
  });

  it('keeps different reading passages with the questions that supplied them', () => {
    const set = questions.slice(0, 2).map((q, index) => ({
      ...q,
      passageText: index === 0 ? 'Anna fährt nach Berlin.' : 'Ben bleibt in Leipzig.',
    }));
    renderSection('READING', {}, 70, set);
    for (let index = 0; index < set.length; index++) {
      const item = screen.getByRole('region', { name: `Question ${index + 1}` }).closest('li')!;
      expect(within(item).getByText(set[index].passageText)).toBeVisible();
      expect(within(item).queryByText(set[1 - index].passageText)).not.toBeInTheDocument();
    }
  });

  it.each(['GRAMMAR', 'READING'] as const)(
    'offers new questions after a below-gate %s result',
    (skill) => {
      const onRetry = renderSection(skill);
      expect(
        screen.queryByRole('button', { name: 'Practise with new questions' })
      ).not.toBeInTheDocument();
      for (let index = 0; index < questions.length; index += 1) {
        fireEvent.click(
          within(screen.getByRole('region', { name: `Question ${index + 1}` })).getByRole(
            'button',
            { name: index < 3 ? 'Option 1: habe' : 'Option 2: bin' }
          )
        );
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

  it('restores a failed saved result with its answers visible and locked', () => {
    renderSection('GRAMMAR', {
      'question-0': 0,
      'question-1': 0,
      'question-2': 0,
      'question-3': 1,
      'question-4': 1,
    });
    expect(screen.getByRole('button', { name: 'Practise with new questions' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue · Reading' })).toBeDisabled();
    for (const option of screen.getAllByRole('button', { name: 'Option 1: habe' })) {
      expect(option).toBeDisabled();
    }
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
