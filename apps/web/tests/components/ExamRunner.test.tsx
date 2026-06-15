/**
 * ExamRunner renders the sections while taking the exam (MC options, submit), and
 * switches to a results view once the exam is SCORED (band + answer key revealed).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/class/SpeakingExercise', () => ({
  SpeakingExercise: () => <div data-testid="speaking-exercise" />,
}));

import { ExamRunner, type ExamData } from '@/components/learn/ExamRunner';

function baseExam(overrides: Partial<ExamData> = {}): ExamData {
  return {
    id: 'exam1',
    institution: 'GOETHE',
    institutionLabel: 'Goethe-Institut',
    level: 'B1',
    status: 'READY',
    examName: 'Goethe-Zertifikat B1',
    sections: [
      {
        id: 's1',
        skill: 'READING',
        part: 'Lesen',
        order: 1,
        format: 'mc',
        weight: 1,
        status: 'READY',
        score: null,
        episode: null,
        questions: [
          { id: 'q1', order: 1, question: 'Was bedeutet Haus?', options: ['house', 'tree'], passageRef: null, passageText: null },
        ],
        speakingPrompts: [],
        writingPrompts: [],
      },
    ],
    result: null,
    ...overrides,
  };
}

describe('ExamRunner', () => {
  it('renders the sections and a submit control while taking the exam', () => {
    render(<ExamRunner exam={baseExam()} />);
    expect(screen.getByText('Lesen')).toBeInTheDocument();
    expect(screen.getByText('Was bedeutet Haus?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit exam/i })).toBeInTheDocument();
    // The unaffiliated disclaimer is always present.
    expect(screen.getByText(/not affiliated with or endorsed by/i)).toBeInTheDocument();
  });

  it('prevents clipboard copy from generated question text', () => {
    render(<ExamRunner exam={baseExam()} />);
    const prompt = screen.getByText('Was bedeutet Haus?');
    const guarded = prompt.closest('[data-learning-text-guard="true"]');
    expect(guarded).toBeInTheDocument();

    const event = createEvent.copy(guarded!);
    fireEvent(guarded!, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows the mock band and reveals the answer key once SCORED', () => {
    const scored = baseExam({
      status: 'SCORED',
      sections: [
        {
          ...baseExam().sections[0],
          score: 1,
          questions: [
            { id: 'q1', order: 1, question: 'Was bedeutet Haus?', options: ['house', 'tree'], passageRef: null, passageText: null, correctIndex: 0, explanation: 'Haus = house.' },
          ],
        },
      ],
      result: {
        overallScore: 0.8,
        band: 'B1 pass (mock)',
        feedback: 'Strong reading.',
        sectionResults: [{ sectionId: 's1', skill: 'READING', score: 1, feedback: 'Nice.' }],
      },
    });
    render(<ExamRunner exam={scored} />);
    expect(screen.getByText('B1 pass (mock)')).toBeInTheDocument();
    expect(screen.getByText(/Haus = house\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit exam/i })).not.toBeInTheDocument();
  });

  it('guards writing prompts while leaving writing responses selectable', () => {
    const writing = baseExam({
      sections: [
        {
          ...baseExam().sections[0],
          id: 's-writing',
          skill: 'WRITING',
          part: 'Schreiben',
          format: 'writing',
          questions: [],
          writingPrompts: [
            {
              id: 'w1',
              order: 1,
              task: 'Schreiben Sie eine Antwort auf Deutsch.',
              guidance: 'Nutzen Sie mindestens zwei Saetze.',
            },
          ],
        },
      ],
    });

    render(<ExamRunner exam={writing} />);

    const task = screen.getByText('Schreiben Sie eine Antwort auf Deutsch.');
    const guarded = task.closest('[data-learning-text-guard="true"]');
    expect(guarded).toBeInTheDocument();

    const promptCopy = createEvent.copy(guarded!);
    fireEvent(guarded!, promptCopy);
    expect(promptCopy.defaultPrevented).toBe(true);

    const textarea = screen.getByLabelText('Your writing response');
    expect(textarea.closest('[data-learning-text-guard="true"]')).toBeNull();

    const responseCopy = createEvent.copy(textarea);
    fireEvent(textarea, responseCopy);
    expect(responseCopy.defaultPrevented).toBe(false);
  });
});
