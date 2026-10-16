import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ListeningSection } from '@/components/learn/ListeningSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('class listening availability', () => {
  it('offers new audio and questions for a failed saved result while keeping revealed answers locked', () => {
    render(
      <ListeningSection
        courseId="demo-course"
        sourceId="demo-listening"
        episode={{
          id: 'demo-audio',
          title: 'A day in the park',
          audioUrl: '/demo.mp3',
          status: 'READY',
          references: [],
        }}
        questions={[
          {
            id: 'demo-question',
            order: 1,
            question: 'Where did they go?',
            options: ['Park', 'Station'],
            correctIndex: 0,
          },
        ]}
        savedAnswers={{ 'demo-question': 1 }}
        gate={70}
        nextName="Speaking"
        onAnswer={vi.fn()}
        onScore={vi.fn()}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText(/new questions and new listening audio/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Practise with new questions' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue · Speaking' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Option 1: Park' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Option 2: Station' })).toBeDisabled();
  });

  it('shows a generation failure instead of telling the learner to wait', () => {
    render(
      <ListeningSection
        courseId="course"
        sourceId="class"
        episode={{
          id: 'audio',
          title: 'Listening',
          status: 'FAILED',
          audioUrl: null,
          references: [],
        }}
        questions={[]}
        gate={70}
        nextName={null}
        onAnswer={vi.fn()}
        onScore={vi.fn()}
        onContinue={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/regenerate this class/i);
    expect(screen.queryByText(/audio is generating/i)).not.toBeInTheDocument();
  });
});
