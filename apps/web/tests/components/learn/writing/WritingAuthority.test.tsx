import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassWritingStage } from '@/components/learn/WritingSection';
import { pauseClassLearningProgress } from '@/components/learn/progress/useLearningProgress';

afterEach(() => vi.unstubAllGlobals());

it('publishes a retained writing grade only after the same class is reverified', async () => {
  const endpoint = '/api/v1/classes/writing-component-authority';
  const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
  let complete: (response: Response) => void = () => {};
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/writing/w1'))
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    if (init?.method === 'PATCH') return Promise.resolve(Response.json({ progressRevision: 1 }));
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch', fetchMock);
  const onScore = vi.fn();
  const onFeedback = vi.fn();
  render(
    <ClassWritingStage
      classId="writing-component-authority"
      sectionId="writing"
      progressRevision={0}
      attempt={1}
      taskMaterialRevision={binding.taskMaterialRevision}
      prompts={[{ id: 'w1', order: 1, task: 'Write a greeting', response: null }]}
      gate={70}
      nextName={null}
      onScore={onScore}
      onFeedback={onFeedback}
      onContinue={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Your written response for prompt 1' }), {
    target: { value: 'Hola' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Check writing' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled());
  const hold = pauseClassLearningProgress(endpoint);
  await act(async () =>
    complete(Response.json({ overallScore: 0.9, corrections: [], feedback: 'Bien' }))
  );
  expect(onScore.mock.calls.some(([score]) => score === 90)).toBe(false);
  expect(onFeedback).not.toHaveBeenCalled();
  hold.verify(binding);
  hold();
  fireEvent.click(screen.getByRole('button', { name: 'Check writing' }));
  await waitFor(() => expect(onScore).toHaveBeenCalledWith(90));
  expect(onFeedback).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/class changed while checking writing/i)).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/writing/w1'))
  ).toHaveLength(1);
});
