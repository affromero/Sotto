import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassTeachingPrelude } from '@/components/learn/lesson/ClassTeachingPrelude';
import { teaching } from './teaching-fixture';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const beforePractice = {
  version: teaching.version,
  title: teaching.title,
  explanation: teaching.explanation,
  workedExamples: teaching.workedExamples,
  commonMistake: teaching.commonMistake,
};
const receiptId = '00000000-0000-4000-a000-000000000001';
const request = { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) };
const base = {
  kind: 'BASE',
  nativeLang: 'en',
  targetLang: 'de',
  receiptId,
  acknowledged: false,
  teaching: beforePractice,
};
const available = {
  kind: 'ADDENDUM',
  nativeLang: 'es',
  targetLang: 'ru',
  request,
  status: 'AVAILABLE',
};
const ready = {
  ...available,
  status: 'READY',
  receiptId,
  acknowledged: false,
  content: {
    title: 'Pedir',
    explanation: 'Usa cortesía.',
    examples: [
      { target: 'Вода, пожалуйста', meaning: 'Agua, por favor', explanation: 'Una petición.' },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('class teaching prelude', () => {
  it('shows reviewed teaching and waits for its exact receipt before mounting practice', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(base))
      .mockResolvedValueOnce(Response.json({ kind: 'BASE', receiptId, acknowledged: true }))
      .mockResolvedValueOnce(Response.json({ ...base, acknowledged: true }));
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    expect(await screen.findByText(teaching.title)).toBeInTheDocument();
    expect(screen.queryByText('Practice section')).not.toBeInTheDocument();
    expect(screen.queryByText(teaching.guidedPractice.prompt)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark basics as read' }));
    expect(await screen.findByText('Practice section')).toBeInTheDocument();
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ kind: 'BASE', receiptId }));
  });

  it('prepares saved teaching only after a learner action and acknowledges it before practice', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(available))
      .mockResolvedValueOnce(Response.json(ready))
      .mockResolvedValueOnce(Response.json({ kind: 'ADDENDUM', receiptId, acknowledged: true }))
      .mockResolvedValueOnce(Response.json({ ...ready, acknowledged: true }));
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Explain the basics' }));
    expect(await screen.findByText('Вода, пожалуйста')).toHaveAttribute('lang', 'ru');
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify(request));
    expect(screen.queryByText('Practice section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark basics as read' }));
    expect(await screen.findByText('Practice section')).toBeInTheDocument();
  });

  it('checks saved status after an uncertain preparation instead of starting it again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(available))
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(Response.json(ready));
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Explain the basics' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.queryByRole('button', { name: 'Explain the basics' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByText('Вода, пожалуйста')).toBeInTheDocument();
    expect(fetch.mock.calls[2][1].method).toBeUndefined();
  });

  it('marks automatic recovery as recovery-only', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...available, status: 'PENDING', recoverable: true }))
      .mockResolvedValueOnce(Response.json(ready));
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    expect(await screen.findByText('Вода, пожалуйста', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(String(fetch.mock.calls[1][0])).toContain('/prepare?recover=1');
    expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify(request));
  });

  it('does not enter practice when the displayed receipt has changed', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(base))
      .mockResolvedValueOnce(Response.json({ kind: 'BASE', receiptId, acknowledged: true }))
      .mockResolvedValueOnce(
        Response.json({
          ...base,
          receiptId: '00000000-0000-4000-a000-000000000002',
          acknowledged: true,
        })
      );
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mark basics as read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The lesson changed');
    expect(screen.queryByText('Practice section')).not.toBeInTheDocument();
  });

  it('checks the classification again if acknowledgment is followed by a different state', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(base))
      .mockResolvedValueOnce(Response.json({ kind: 'BASE', receiptId, acknowledged: true }))
      .mockResolvedValueOnce(Response.json({ kind: 'NOT_REQUIRED' }))
      .mockResolvedValueOnce(Response.json({ kind: 'NOT_REQUIRED' }));
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mark basics as read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The lesson changed');
    expect(screen.queryByText('Practice section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByText('Practice section')).toBeInTheDocument();
  });

  it('offers a status check when recovery is required', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...available, status: 'UNRESOLVED' }))
      .mockResolvedValueOnce(Response.json(ready));
    vi.stubGlobal('fetch', fetch);
    render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    expect(
      await screen.findByText('This lesson needs recovery before practice can start.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check saved status' }));
    expect(await screen.findByText('Вода, пожалуйста')).toBeInTheDocument();
  });

  it('does not apply a late response after the class is left', async () => {
    let resolve: (value: Response) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <ClassTeachingPrelude classId="class-1">
        <p>Practice section</p>
      </ClassTeachingPrelude>
    );
    expect(await screen.findByText('Checking your lesson')).toBeInTheDocument();
    view.unmount();
    resolve(Response.json({ kind: 'NOT_REQUIRED' }));
    await waitFor(() => expect(screen.queryByText('Practice section')).not.toBeInTheDocument());
  });
});
