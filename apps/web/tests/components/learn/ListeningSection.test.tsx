import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListeningSection } from '@/components/learn/ListeningSection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('class listening availability', () => {
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
