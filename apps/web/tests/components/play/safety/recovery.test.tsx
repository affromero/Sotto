import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayOwnerReview } from '@/components/play/safety/PlayOwnerReview';
import { PlaySafety } from '@/components/play/safety/PlaySafety';
import { safety, safetyResponse } from './fixtures';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function reviewReport(id: string, text: string, status: 'OPEN' | 'RESOLVED' = 'OPEN') {
  return {
    ...safety.report,
    ...safety.review,
    id,
    status,
    evidence: { ...safety.report.evidence, text },
    subjectRestricted: false,
    allowedActions: ['RESPOND', 'RESTRICT_PLAY'],
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safety recovery across remote commits and stale pages', () => {
  it('keeps a committed owner decision and its exact retry when the open inbox no longer contains it', async () => {
    const report = reviewReport(safety.report.id, 'Reported visible message');
    const emptyPoll = deferred<Response>();
    const pollStarted = deferred<void>();
    const retryAck = deferred<Response>();
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    let committed = false;
    let heldPoll = false;
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const policy = safetyResponse(path);
      if (policy) return policy;
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        requests.push({ path, body });
        if (!committed) {
          committed = true;
          throw new TypeError('The response was lost after the server committed.');
        }
        return retryAck.promise;
      }
      if (committed) {
        if (!heldPoll) {
          heldPoll = true;
          pollStarted.resolve();
          return emptyPoll.promise;
        }
        return Response.json({ reports: [], nextCursor: null });
      }
      return Response.json({ reports: [report], nextCursor: null });
    });
    render(<PlayOwnerReview />);
    const response = await screen.findByRole('textbox', {
      name: 'Response to the reporting player',
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'RESTRICT_PLAY' } });
    fireEvent.change(response, {
      target: { value: 'I reviewed this message and restricted games.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    await screen.findByRole('button', { name: 'Retry review decision' });
    expect(screen.getByLabelText('Reports')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh reports' })).toBeDisabled();

    act(() => window.dispatchEvent(new Event('online')));
    await pollStarted.promise;
    await act(async () => {
      emptyPoll.resolve(Response.json({ reports: [], nextCursor: null }));
    });
    expect(screen.getByText('Reported visible message')).toBeVisible();
    expect(response).toHaveValue('I reviewed this message and restricted games.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry review decision' }));
    await waitFor(() => expect(response).toBeDisabled());
    expect(screen.getByLabelText('Reports')).toBeDisabled();
    await act(async () => {
      retryAck.resolve(Response.json({ actionId: requests[0].body.actionId, completed: true }));
    });
    await waitFor(() =>
      expect(screen.queryByText('Reported visible message')).not.toBeInTheDocument()
    );
    expect(screen.getByLabelText('Reports')).toBeEnabled();
    expect(requests).toEqual([
      {
        path: `/api/v1/play/safety/review/${report.id}`,
        body: expect.objectContaining({
          actionId: expect.any(String),
          expectedRevision: report.revision,
          action: 'RESTRICT_PLAY',
          response: 'I reviewed this message and restricted games.',
        }),
      },
      requests[0],
    ]);
    expect(
      Object.values(localStorage).join('') + Object.values(sessionStorage).join('')
    ).not.toContain('I reviewed this message');
  });

  it('releases pagination when the owner changes filters and ignores the old page response', async () => {
    const oldPage = deferred<Response>();
    const oldPageStarted = deferred<void>();
    const open = reviewReport('dcb02e24-0429-4840-b907-85df92d27c65', 'Current open evidence');
    const stale = reviewReport('b604c532-5b69-4b71-989b-4091e487233a', 'Stale open evidence');
    const resolved = reviewReport(
      'b915e63a-362b-486e-a233-005f76c9159d',
      'Current resolved evidence',
      'RESOLVED'
    );
    const olderResolved = reviewReport(
      '0e0ba21d-6d73-44a4-9d2d-fbb7de9871c2',
      'Older resolved evidence',
      'RESOLVED'
    );
    vi.stubGlobal('fetch', async (path: string) => {
      const policy = safetyResponse(path);
      if (policy) return policy;
      if (path.includes('status=OPEN') && path.includes('beforeId=')) {
        oldPageStarted.resolve();
        return oldPage.promise;
      }
      if (path.includes('status=RESOLVED')) {
        return Response.json(
          path.includes('beforeId=')
            ? { reports: [olderResolved], nextCursor: null }
            : { reports: [resolved], nextCursor: resolved.id }
        );
      }
      return Response.json({ reports: [open], nextCursor: open.id });
    });
    render(<PlayOwnerReview />);
    await screen.findByText('Current open evidence');
    fireEvent.click(screen.getByRole('button', { name: 'More reports' }));
    await oldPageStarted.promise;
    expect(screen.getByRole('button', { name: 'More reports' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reports'), { target: { value: 'RESOLVED' } });
    await screen.findByText('Current resolved evidence');
    const more = screen.getByRole('button', { name: 'More reports' });
    expect(more).toBeEnabled();
    fireEvent.click(more);
    await screen.findByText('Older resolved evidence');
    await act(async () => {
      oldPage.resolve(Response.json({ reports: [stale], nextCursor: 'stale-cursor' }));
    });
    expect(screen.queryByText('Stale open evidence')).not.toBeInTheDocument();
    expect(screen.getByText('Current resolved evidence')).toBeVisible();
    expect(screen.getByText('Older resolved evidence')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'More reports' })).not.toBeInTheDocument();
  });

  it.each(['older page', 'first page poll'])(
    'ignores a delayed %s after an acknowledged unblock resets the list',
    async (pendingRead) => {
      const oldResponse = deferred<Response>();
      const oldReadStarted = deferred<void>();
      const blocked = safety.blocks.blocks[0];
      const requests: { path: string; body: Record<string, unknown> }[] = [];
      let holdFirstPage = false;
      let unblocked = false;
      vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
        const policy = safetyResponse(path);
        if (policy) return policy;
        if (options?.method === 'POST') {
          const body = JSON.parse(String(options.body));
          requests.push({ path, body });
          unblocked = true;
          return Response.json({ actionId: body.actionId, completed: true });
        }
        if (path.includes('/blocks')) {
          if (unblocked) return Response.json({ blocks: [], nextCursor: null });
          if (path.includes('beforeId=') || holdFirstPage) {
            oldReadStarted.resolve();
            return oldResponse.promise;
          }
          return Response.json({ blocks: [blocked], nextCursor: blocked.blockedUserId });
        }
        return Response.json({ reports: [], nextCursor: null });
      });
      render(<PlaySafety />);
      await screen.findByRole('button', { name: `Unblock ${blocked.name}` });
      if (pendingRead === 'older page') {
        fireEvent.click(screen.getByRole('button', { name: 'More blocked players' }));
      } else {
        holdFirstPage = true;
        act(() => window.dispatchEvent(new Event('online')));
      }
      await oldReadStarted.promise;
      fireEvent.click(screen.getByRole('button', { name: `Unblock ${blocked.name}` }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm unblock' }));
      await screen.findByText('No blocked players.');
      await act(async () => {
        oldResponse.resolve(Response.json({ blocks: [blocked], nextCursor: 'stale-block-cursor' }));
      });
      expect(
        screen.queryByRole('button', { name: `Unblock ${blocked.name}` })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'More blocked players' })
      ).not.toBeInTheDocument();
      expect(screen.getByText('No blocked players.')).toBeVisible();
      expect(requests).toEqual([
        {
          path: `/api/v1/play/safety/blocks/${blocked.blockedUserId}/unblock`,
          body: { actionId: expect.any(String) },
        },
      ]);
    }
  );
});
