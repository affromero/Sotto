import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaySafety } from '@/components/play/safety/PlaySafety';
import { PlayReport } from '@/components/play/safety/PlayReport';
import { PlayOwnerReview } from '@/components/play/safety/PlayOwnerReview';
import { usePlaySafetyMutation } from '@/components/play/safety/safety-client';
import { safety, safetyResponse, safetyRoom } from './fixtures';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('game safety controls', () => {
  it('requires unchecked explicit conduct and confirms only the matching acceptance action', async () => {
    let accepted = false;
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        sent.push(body);
        accepted = true;
        return Response.json({ actionId: body.actionId, completed: true });
      }
      if (path === '/api/v1/play/safety')
        return Response.json(accepted ? safety.accepted : safety.unaccepted);
      const rules = safetyResponse(path);
      if (rules) return rules;
      return Response.json(
        path.endsWith('/blocks')
          ? { blocks: [], nextCursor: null }
          : { reports: [], nextCursor: null }
      );
    });
    render(<PlaySafety />);
    const consent = await screen.findByRole('checkbox', { name: /I accept this server/ });
    expect(consent).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Accept game conduct' })).toBeDisabled();
    expect(sent).toEqual([]);
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole('button', { name: 'Accept game conduct' }));
    await screen.findByText('Conduct accepted for this profile.');
    expect(sent).toEqual([expect.objectContaining({ version: safety.policy.version })]);
    expect(
      screen.queryByRole('checkbox', { name: /I accept this server/ })
    ).not.toBeInTheDocument();
  });

  it('preserves a wrong acknowledgment and rate-limited action for the exact same retry', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      sent.push(body);
      if (sent.length === 1) return Response.json(safety.completed);
      if (sent.length === 2)
        return Response.json({ error: 'Wait before retrying.' }, { status: 429 });
      return Response.json({ actionId: body.actionId, completed: true });
    });
    const hook = renderHook(() => usePlaySafetyMutation());
    const body = { actionId: '3d82391f-d4d1-44d1-adb2-408c689b2cec', version: 1 };
    let result: Promise<unknown> | undefined;
    await act(async () => {
      result = hook.result.current.run('/api/v1/play/safety/conduct', body);
    });
    expect(hook.result.current).toMatchObject({ pending: true, uncertain: true });
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(hook.result.current).toMatchObject({ pending: true, uncertain: true });
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(await result).toEqual({ actionId: body.actionId, completed: true });
    expect(sent).toEqual([body, body, body]);
    hook.unmount();
  });

  it('blocks independently and keeps visible evidence available for reporting after the block', async () => {
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      sent.push({ path, body });
      return Response.json({ actionId: body.actionId, completed: true });
    });
    const blocked = vi.fn();
    render(
      <PlayReport
        room={safetyRoom()}
        onBlocked={blocked}
        onClose={() => {}}
        onPendingChange={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Block partner' }));
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm block partner' }));
    await screen.findByText('Partner blocked.');
    expect(blocked).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Explanation (optional)'), {
      target: { value: 'Please review this player name.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report to server owner' }));
    await screen.findByText(/Report sent to this server/);
    expect(sent.map((item) => item.path)).toEqual([
      '/api/v1/play/rooms/fixture-room/block',
      '/api/v1/play/rooms/fixture-room/reports',
    ]);
    expect(sent[1].body).toMatchObject({
      selector: { kind: 'PARTNER_NAME' },
      expectedVisibleText: 'Sam',
      detail: 'Please review this player name.',
    });
    expect(
      Object.values(localStorage).join('') + Object.values(sessionStorage).join('')
    ).not.toContain('Please review');
  });

  it('keeps older blocked players across polls and unblocks by profile without requiring an old game', async () => {
    const older = {
      blockedUserId: 'older-partner',
      name: 'Older partner',
      createdAt: safety.blocks.blocks[0].createdAt,
    };
    const posts: { path: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        posts.push({ path, body });
        return Response.json({ actionId: body.actionId, completed: true });
      }
      const current = safetyResponse(path);
      if (current) return current;
      if (path.includes('beforeId=')) return Response.json({ blocks: [older], nextCursor: null });
      if (path.endsWith('/blocks'))
        return Response.json({ ...safety.blocks, nextCursor: 'first-page' });
      return Response.json({ reports: [safety.report], nextCursor: null });
    });
    render(<PlaySafety />);
    fireEvent.click(await screen.findByRole('button', { name: 'More blocked players' }));
    await screen.findByText('Older partner');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'More blocked players' })).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unblock Older partner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unblock' }));
    await waitFor(() => expect(screen.queryByText('Older partner')).not.toBeInTheDocument());
    expect(posts).toEqual([
      {
        path: '/api/v1/play/safety/blocks/older-partner/unblock',
        body: expect.objectContaining({ actionId: expect.any(String) }),
      },
    ]);
    expect(screen.getByText(safety.report.response)).toBeVisible();
  });

  it('sends an owner decision only after confirmation with its displayed revision and response', async () => {
    const report = {
      ...safety.report,
      ...safety.review,
      status: 'OPEN',
      subjectRestricted: false,
      allowedActions: ['RESPOND', 'RESTRICT_PLAY'],
    };
    const sent: Record<string, unknown>[] = [];
    let decided = false;
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
      const current = safetyResponse(path);
      if (current) return current;
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        sent.push(body);
        decided = true;
        return Response.json({ actionId: body.actionId, completed: true });
      }
      return Response.json({ reports: decided ? [] : [report], nextCursor: null });
    });
    render(<PlayOwnerReview />);
    const response = await screen.findByRole('textbox', {
      name: 'Response to the reporting player',
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'RESTRICT_PLAY' } });
    fireEvent.change(response, { target: { value: 'I have restricted this profile from games.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review decision' }));
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Response to the reporting player' })
      ).not.toBeInTheDocument()
    );
    expect(sent).toEqual([
      expect.objectContaining({
        action: 'RESTRICT_PLAY',
        expectedRevision: report.revision,
        response: 'I have restricted this profile from games.',
      }),
    ]);
  });
});
