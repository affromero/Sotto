import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScriptEditor } from '@/components/create/ScriptEditor';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('script revision submission', () => {
  it('autosaves the edited turns only after the five-second quiet period', async () => {
    const saved: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        saved.push({ url, body: JSON.parse(String(options.body)) });
        return Response.json({ version: 2 });
      }
      return Response.json({ turns: [{ speaker: 'HOST', text: 'Original lesson.' }], version: 1 });
    });
    render(<ScriptEditor episodeId="auto-save" onApprove={vi.fn()} onRegenerate={vi.fn()} />);
    await screen.findByText('Original lesson.');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Edit turn' }));
    const editor = screen.getByRole('textbox', { name: 'Edit turn text' });
    fireEvent.change(editor, { target: { value: 'Revised lesson.' } });
    fireEvent.blur(editor);
    await act(async () => vi.advanceTimersByTimeAsync(4999));
    expect(saved).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(saved).toEqual([
      {
        url: '/api/v1/episodes/auto-save/script',
        body: { turns: [{ speaker: 'HOST', text: 'Revised lesson.' }] },
      },
    ]);
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  });

  it('keeps selection annotations within the measured editor width', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ turns: [{ speaker: 'HOST', text: 'Select these lesson words.' }] })
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(375);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 375, 400)
    );
    const { rerender } = render(
      <ScriptEditor episodeId="selection" onApprove={vi.fn()} onRegenerate={vi.fn()} />
    );
    const text = await screen.findByText('Select these lesson words.');
    const range = document.createRange();
    range.selectNodeContents(text);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => new DOMRect(350, 100, 60, 20),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(text);
    const annotation = screen.getByPlaceholderText('Add a note about this text...').parentElement!;
    const left = Number.parseFloat(annotation.style.left);
    const editorWidth = 375;
    const annotationWidth = 240;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + annotationWidth).toBeLessThanOrEqual(editorWidth);
    rerender(<ScriptEditor episodeId="selection" onApprove={vi.fn()} onRegenerate={vi.fn()} />);
    expect(Number.parseFloat(annotation.style.left)).toBe(left);
    selection.removeAllRanges();
  });
  it('binds annotations to the loaded script and displays a stale revision conflict', async () => {
    const user = userEvent.setup();
    let submitted: unknown;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submitted = JSON.parse(String(init.body));
        return Response.json(
          { error: 'The original script changed. Reload before regenerating.' },
          { status: 409 }
        );
      }
      return Response.json({
        scriptId: 'original-script',
        version: 3,
        turns: [{ speaker: 'HOST', text: 'Welcome to this lesson.' }],
        references: [],
      });
    });
    render(<ScriptEditor episodeId="episode-1" onApprove={vi.fn()} onRegenerate={vi.fn()} />);
    await screen.findByText('Welcome to this lesson.');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await user.type(screen.getByRole('textbox', { name: 'Comment on turn 1' }), 'Make this warmer');
    await user.click(screen.getByRole('button', { name: 'Regenerate Script' }));
    await user.click(screen.getByRole('button', { name: /with.*notes/i }));
    expect(
      await screen.findByText('The original script changed. Reload before regenerating.')
    ).toBeInTheDocument();
    expect(submitted).toEqual({
      originalScript: { id: 'original-script', version: 3 },
      turnComments: { 0: 'Make this warmer' },
    });
  });
});
