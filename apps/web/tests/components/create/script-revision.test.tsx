import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScriptEditor } from '@/components/create/ScriptEditor';

afterEach(() => vi.unstubAllGlobals());

describe('script revision submission', () => {
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
