import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import { FeedbackClinic } from '@/components/learn/ClassSummary';
import { GrammarSection } from '@/components/learn/GrammarSection';
import type { ClassFeedbackNote } from '@/components/learn/classTypes';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

describe('live feedback recovery', () => {
  it('does not round a below-gate live score up to a passing percentage', () => {
    render(
      <FeedbackClinic
        sections={[]}
        vocabulary={[]}
        liveSection={{
          id: 'near-gate',
          skill: 'GRAMMAR',
          score: 16 / 23,
          complete: true,
          passed: false,
        }}
      />
    );
    expect(screen.getByText('69.5%')).toBeVisible();
    expect(screen.queryByText('70%')).not.toBeInTheDocument();
  });

  it('shows missed concepts before later correct answers and keeps the aggregate score distinct', () => {
    const questions = Array.from({ length: 5 }, (_, index) => ({
      id: `review-${index}`,
      order: index + 1,
      question: `Choose the form for sentence ${index + 1}.`,
      options: ['habe', 'bin'],
      correctIndex: 0,
      explanation: `Review concept ${index + 1}.`,
    }));
    function RecoveryFlow() {
      const [feedbackNotes, setFeedbackNotes] = useState<ClassFeedbackNote[]>([]);
      const [score, setScore] = useState(0);
      const [result, setResult] = useState({ complete: false, passed: false });
      const recordFeedback = useCallback(
        (note: ClassFeedbackNote) => setFeedbackNotes((previous) => [note, ...previous]),
        []
      );
      const recordCompletion = useCallback(
        (complete: boolean, passed: boolean) => setResult({ complete, passed }),
        []
      );
      return (
        <>
          <GrammarSection
            courseId="demo"
            sourceId="demo-grammar"
            skill="GRAMMAR"
            questions={questions}
            gate={70}
            nextName="Reading"
            onAnswer={() => {}}
            onScore={setScore}
            onContinue={() => {}}
            onFeedback={recordFeedback}
            onCompletionChange={recordCompletion}
            onRetry={() => {}}
          />
          <FeedbackClinic
            sections={[]}
            vocabulary={[]}
            feedbackNotes={feedbackNotes}
            liveSection={{ id: 'demo-grammar', skill: 'GRAMMAR', score: score / 100, ...result }}
          />
        </>
      );
    }
    render(<RecoveryFlow />);
    for (let index = 0; index < questions.length; index += 1) {
      fireEvent.click(
        screen.getByRole('button', { name: index < 2 ? 'Option 2: bin' : 'Option 1: habe' })
      );
      fireEvent.click(screen.getByRole('button', { name: index === 4 ? 'See result' : 'Next' }));
    }
    const clinic = within(screen.getByRole('region', { name: 'Feedback Clinic' }));
    const liveNotes = clinic.getByRole('heading', { name: 'Live notes' }).closest('article')!;
    expect([...liveNotes.querySelectorAll('p')].map((note) => note.textContent)).toEqual([
      'Review concept 2.',
      'Review concept 1.',
      'Review concept 5.',
      'Review concept 4.',
      'Review concept 3.',
    ]);
    expect(clinic.getByText('60%')).toBeVisible();
    expect(clinic.queryByText('100%')).not.toBeInTheDocument();
  });

  it('shows the failed live skill and a fresh-question action before final submission', () => {
    const onRetrySection = vi.fn();
    render(
      <FeedbackClinic
        sections={[]}
        vocabulary={[]}
        liveSection={{
          id: 'demo-grammar',
          skill: 'GRAMMAR',
          score: 0.6,
          complete: true,
          passed: false,
        }}
        onRetrySection={onRetrySection}
      />
    );
    const clinic = within(screen.getByRole('region', { name: 'Feedback Clinic' }));
    expect(clinic.getByText('Grammar')).toBeVisible();
    expect(clinic.getByText('60%')).toBeVisible();
    expect(clinic.queryByText(/No weak skill score/i)).not.toBeInTheDocument();
    fireEvent.click(clinic.getByRole('button', { name: 'Practise with new questions' }));
    expect(onRetrySection).toHaveBeenCalledOnce();
  });

  it('keeps the replacement action disabled while fresh questions are being prepared', () => {
    render(
      <FeedbackClinic
        sections={[]}
        vocabulary={[]}
        retrying
        liveSection={{
          id: 'demo-reading',
          skill: 'READING',
          score: 0.4,
          complete: true,
          passed: false,
        }}
        onRetrySection={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Preparing new questions...' })).toBeDisabled();
  });
});
