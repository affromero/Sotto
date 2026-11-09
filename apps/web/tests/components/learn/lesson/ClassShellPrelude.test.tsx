import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { ClassShell } from '@/components/learn/ClassShell';
import { teaching } from './teaching-fixture';
import { useLearningProgress } from '@/components/learn/progress/useLearningProgress';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

it('waits for prerequisite acknowledgment before fetching a deep-linked section', async () => {
  const receiptId = '00000000-0000-4000-a000-000000000001';
  const beforePractice = {
    version: teaching.version,
    title: teaching.title,
    explanation: teaching.explanation,
    workedExamples: teaching.workedExamples,
    commonMistake: teaching.commonMistake,
  };
  const prelude = {
    kind: 'BASE',
    nativeLang: 'en',
    targetLang: 'de',
    receiptId,
    acknowledged: false,
    teaching: beforePractice,
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/teaching-prelude/acknowledge'))
      return Response.json({ kind: 'BASE', receiptId, acknowledged: true });
    if (url.endsWith('/teaching-prelude'))
      return Response.json({
        ...prelude,
        acknowledged: Boolean(init && fetch.mock.calls.length > 1),
      });
    if (url.endsWith('/api/v1/classes/class-1')) return new Response(null, { status: 404 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(<ClassShell classId="class-1" initialSectionId="section-1" />);
  expect(await screen.findByText(teaching.title)).toBeInTheDocument();
  expect(
    fetch.mock.calls.some(([input]) => String(input).endsWith('/api/v1/classes/class-1'))
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Mark basics as read' }));
  await waitFor(() => expect(screen.getByText('Class not found.')).toBeInTheDocument());
  expect(
    fetch.mock.calls.some(([input]) => String(input).endsWith('/api/v1/classes/class-1'))
  ).toBe(true);
});

it('does not open a class when its teaching receipt changes during initial loading', async () => {
  const receiptId = '00000000-0000-4000-a000-000000000001';
  const prelude = {
    kind: 'BASE',
    nativeLang: 'en',
    targetLang: 'de',
    receiptId,
    acknowledged: true,
    teaching: {
      version: teaching.version,
      title: teaching.title,
      explanation: teaching.explanation,
      workedExamples: teaching.workedExamples,
      commonMistake: teaching.commonMistake,
    },
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/teaching-prelude')) return Response.json(prelude);
    if (url.endsWith('/focus-snapshot'))
      return Response.json({
        prelude: { ...prelude, receiptId: '00000000-0000-4000-a000-000000000002' },
        progress: {
          classId: 'class-1',
          status: 'IN_PROGRESS',
          attempt: 1,
          progressRevision: 0,
          taskMaterialRevision: 'a'.repeat(64),
        },
      });
    if (url.endsWith('/api/v1/classes/class-1'))
      return Response.json({
        id: 'class-1',
        status: 'IN_PROGRESS',
        attempt: 1,
        taskMaterialRevision: 'a'.repeat(64),
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ClassShell classId="class-1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('The class changed');
  expect(screen.getByRole('button', { name: 'View progress in Learn' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/focus-snapshot'))).toBe(
    true
  );
  expect(screen.queryByText('Class overview')).not.toBeInTheDocument();
});

it('releases an abandoned initial check so a reopened class can verify retained work', async () => {
  const endpoint = '/api/v1/classes/remount-class';
  const binding = { expectedAttempt: 1, taskMaterialRevision: 'a'.repeat(64) };
  let details = 0;
  let aborted = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH') return Response.json({ progressRevision: 1 });
    if (url.endsWith('/teaching-prelude')) return Response.json({ kind: 'NOT_REQUIRED' });
    if (url.endsWith('/focus-snapshot'))
      return Response.json({
        prelude: { kind: 'NOT_REQUIRED' },
        progress: {
          classId: 'remount-class',
          status: 'IN_PROGRESS',
          attempt: 1,
          progressRevision: 0,
          taskMaterialRevision: binding.taskMaterialRevision,
        },
      });
    if (url.endsWith(endpoint)) {
      details += 1;
      if (details === 1)
        return new Promise<Response>((resolve) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve(new Response(null, { status: 499 }));
          });
        });
      return Response.json({
        id: 'remount-class',
        courseId: 'course',
        status: 'IN_PROGRESS',
        attempt: 1,
        taskMaterialRevision: binding.taskMaterialRevision,
        submitted: false,
        progressRevision: 0,
        sections: [],
        lesson: { title: 'Lesson', level: 'A1', objective: 'Learn' },
        intro: { purpose: 'Learn', about: 'Learn', focus: [], examples: [], tips: [] },
        vocabulary: [],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const draft = renderHook(
    ({ text }) =>
      useLearningProgress(endpoint, { writingDrafts: { w1: text } }, true, 0, '1', binding),
    { initialProps: { text: '' } }
  );
  draft.rerender({ text: 'Keep my draft' });
  const first = render(<ClassShell classId="remount-class" />);
  await waitFor(() => expect(details).toBe(1));
  draft.unmount();
  first.unmount();
  expect(aborted).toBe(true);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  render(
    <StrictMode>
      <ClassShell classId="remount-class" />
    </StrictMode>
  );
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true)
  );
});

it('does not poll a generating class after its view is left', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/teaching-prelude')) return Response.json({ kind: 'NOT_REQUIRED' });
    if (url.endsWith('/api/v1/classes/generating-class'))
      return Response.json({ id: 'generating-class', status: 'GENERATING', submitted: false });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<ClassShell classId="generating-class" />);
  expect(await screen.findByText('Preparing this class')).toBeInTheDocument();
  view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 2100));
  expect(
    fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith('/api/v1/classes/generating-class')
    )
  ).toHaveLength(1);
});
