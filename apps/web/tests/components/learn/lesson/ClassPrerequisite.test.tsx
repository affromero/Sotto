import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassPrerequisite } from '@/components/learn/lesson/ClassPrerequisite';
import { ClassTeachingNotes } from '@/components/learn/lesson/ClassTeachingNotes';
import { teaching } from './teaching-fixture';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const request = { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) };
const base = { request, nativeLang: 'es', targetLang: 'ru' };
const ready = {
  ...base,
  status: 'READY',
  receiptId: '00000000-0000-4000-a000-000000000001',
  acknowledged: false,
  content: {
    title: 'Pedir con cortesía',
    explanation: 'Di el objeto y añade «пожалуйста».',
    examples: [
      {
        target: 'Вода, пожалуйста',
        meaning: 'Agua, por favor',
        explanation: 'Usa esta fórmula al pedir.',
      },
    ],
    directions: {
      guided: 'Pide una bebida con cortesía.',
      tasks: [
        {
          sectionId: 'grammar',
          taskId: 'q1',
          kind: 'question',
          instruction: 'Formula una pregunta.',
        },
      ],
    },
  },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saved prerequisite teaching', () => {
  it('explains when a class is too large before any preparation is started', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...base, status: 'AVAILABLE' }))
      .mockResolvedValueOnce(Response.json({ ...base, status: 'AVAILABLE' }))
      .mockResolvedValueOnce(
        Response.json({ error: 'This class is too large to prepare safely.' }, { status: 422 })
      );
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Explain the basics' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This class is too large to prepare safely.'
    );
    fireEvent.focus(window);
    expect(screen.queryByRole('button', { name: 'Check saved status' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('shows saved teaching before guided practice without opening the answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(ready)));
    render(
      <ClassTeachingNotes
        classId="class-1"
        courseId="course-1"
        teaching={teaching}
        prerequisiteSourceHash={request.sourceHash}
        intro={{ purpose: 'Pedir.', about: 'Una petición.', focus: [], examples: [], tips: [] }}
      />
    );
    const prerequisite = await screen.findByText('Pedir con cortesía');
    const guided = screen.getByRole('region', { name: 'Try it first' });
    expect(
      prerequisite.compareDocumentPosition(guided) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText(teaching.guidedPractice.answer).closest('details')).not.toHaveAttribute(
      'open'
    );
  });
  it('requests an explanation and keeps learner work in place', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...base, status: 'AVAILABLE' }))
      .mockResolvedValueOnce(Response.json({ ...base, status: 'AVAILABLE' }))
      .mockResolvedValueOnce(Response.json(ready));
    vi.stubGlobal('fetch', fetch);
    render(
      <>
        <ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />
        <label>
          Draft
          <input defaultValue="Mi borrador" />
        </label>
      </>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Explain the basics' }));
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    expect(screen.getByText('Вода, пожалуйста')).toHaveAttribute('lang', 'ru');
    expect(screen.getByText('Agua, por favor').closest('[lang]')).toHaveAttribute('lang', 'es');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Mi borrador');
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'POST', body: JSON.stringify(request) });
  });

  it('continues only after saving the exact explanation that was displayed', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ready))
      .mockResolvedValueOnce(Response.json({ ...ready, acknowledged: true }));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark basics as read' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark basics as read' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('status')).toHaveTextContent('Basics marked as read.');
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/classes/class-1/prerequisite/acknowledge');
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ sourceHash: request.sourceHash, receiptId: ready.receiptId }),
    });
  });

  it('does not accept acknowledgment for a different displayed receipt', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ready))
      .mockResolvedValueOnce(
        Response.json({
          ...ready,
          receiptId: '00000000-0000-4000-a000-000000000002',
          acknowledged: true,
        })
      );
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark basics as read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The explanation changed');
    expect(screen.queryByText('Pedir con cortesía')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check saved status' })).toBeInTheDocument();
  });

  it('checks saved status after an interrupted acknowledgment instead of submitting again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ready))
      .mockImplementationOnce(
        (_url, options: RequestInit) =>
          new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
          })
      )
      .mockResolvedValueOnce(Response.json({ ...ready, acknowledged: true }));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark basics as read' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saving your place'));
    fireEvent.focus(window);
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark basics as read' })).not.toBeInTheDocument();
    expect(fetch.mock.calls[2][1].method).toBeUndefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers a lost acknowledgment response by reading the saved status', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ready))
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(Response.json({ ...ready, acknowledged: true }));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark basics as read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark basics as read' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
  });

  it('resumes a pending request without posting again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...base, status: 'PENDING' }))
      .mockResolvedValueOnce(Response.json(ready));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Preparing your explanation');
    await waitFor(() => expect(screen.getByText('Pedir con cortesía')).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(fetch.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });

  it('acknowledges a completed repair after the worker loses its response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...base, status: 'PENDING', recoverable: true }))
      .mockResolvedValueOnce(Response.json(ready));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Preparing your explanation');
    await waitFor(() => expect(screen.getByText('Pedir con cortesía')).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify(request) });
  });

  it('keeps uncertain work blocked and offers no retry', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...base, status: 'UNRESOLVED' }));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('needs recovery');
    expect(screen.queryByRole('button', { name: /explanation|basics/i })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('explains a conservative safety refusal without offering the same paid retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...base,
          status: 'FAILED',
          failure: 'UNSAFE',
          canRetry: false,
        })
      )
    );
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be prepared safely');
    expect(
      screen.queryByRole('button', { name: 'Prepare a new explanation' })
    ).not.toBeInTheDocument();
  });

  it('retries a confirmed failure using a fresh saved revision', async () => {
    const changedRequest = { ...request, snapshotHash: 'c'.repeat(64) };
    const failed = { ...base, status: 'FAILED', canRetry: true };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(failed))
      .mockResolvedValueOnce(Response.json({ ...failed, request: changedRequest }))
      .mockResolvedValueOnce(Response.json({ ...ready, request: changedRequest }));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="class-1" sourceHash={request.sourceHash} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare a new explanation' }));
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    expect(fetch.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(changedRequest),
    });
  });

  it('does not show a previous class response after navigation', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(Response.json({ ...base, status: 'AVAILABLE' }));
    vi.stubGlobal('fetch', fetch);
    const view = render(<ClassPrerequisite classId="first" sourceHash={request.sourceHash} />);
    expect(await screen.findByText('Checking your lesson…')).toBeInTheDocument();
    view.rerender(<ClassPrerequisite classId="second" sourceHash={request.sourceHash} />);
    expect(await screen.findByRole('button', { name: 'Explain the basics' })).toBeInTheDocument();
    await act(async () => {
      resolveFirst?.(Response.json(ready));
    });
    expect(screen.queryByText('Pedir con cortesía')).not.toBeInTheDocument();
  });

  it('removes saved teaching immediately when the class changes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ready))
      .mockResolvedValueOnce(Response.json({ ...base, status: 'PENDING' }));
    vi.stubGlobal('fetch', fetch);
    const view = render(<ClassPrerequisite classId="first" sourceHash={request.sourceHash} />);
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    view.rerender(<ClassPrerequisite classId="second" sourceHash={request.sourceHash} />);
    expect(screen.queryByText('Pedir con cortesía')).not.toBeInTheDocument();
  });

  it('removes saved teaching when the same class loads a new source revision', async () => {
    const changed = {
      ...base,
      request: { ...request, sourceHash: 'c'.repeat(64) },
      status: 'PENDING',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(ready))
        .mockResolvedValueOnce(Response.json(changed))
    );
    const view = render(
      <>
        <ClassPrerequisite classId="first" sourceHash={request.sourceHash} />
        <label>
          Draft
          <input defaultValue="Sin terminar" />
        </label>
      </>
    );
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    view.rerender(
      <>
        <ClassPrerequisite classId="first" sourceHash={changed.request.sourceHash} />
        <label>
          Draft
          <input defaultValue="Sin terminar" />
        </label>
      </>
    );
    expect(screen.queryByText('Pedir con cortesía')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Sin terminar');
    expect(await screen.findByRole('status')).toHaveTextContent('Preparing your explanation');
  });

  it('hides stale teaching on focus and never posts a mismatched recovery request', async () => {
    const changed = {
      ...base,
      request: { ...request, sourceHash: 'c'.repeat(64) },
      status: 'PENDING',
      recoverable: true,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ready))
      .mockResolvedValueOnce(Response.json(changed));
    vi.stubGlobal('fetch', fetch);
    render(<ClassPrerequisite classId="first" sourceHash={request.sourceHash} />);
    expect(await screen.findByText('Pedir con cortesía')).toBeInTheDocument();
    fireEvent.focus(window);
    expect(await screen.findByRole('alert')).toHaveTextContent('class changed');
    expect(screen.queryByText('Pedir con cortesía')).not.toBeInTheDocument();
    expect(fetch.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });
});
