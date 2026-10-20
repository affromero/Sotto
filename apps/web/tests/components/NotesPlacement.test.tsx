import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotesPlacement } from '@/components/placement/NotesPlacement';
import { completeMaterialCoverage, partialMaterialCoverage } from '../helpers/materials/analysis';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body } as Response;
}
const analysisId = 'b0687e4b-16d2-438b-a946-2a78bf8bf079';
const resultDigest = 'a'.repeat(64);
const analysis = {
  analysisId,
  analysisRevision: 1,
  identityDigest: 'd'.repeat(64),
  status: 'COMPLETE',
  resultDigest,
  summary: {
    focusCount: 3,
    inference: { level: 'B1', rationale: 'Uses past tense.', confidence: 0.8 },
  },
};

describe('NotesPlacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  async function deduce(status = 'COMPLETE') {
    const onVerify = vi.fn();
    render(<NotesPlacement native="en" target="es" onVerify={onVerify} />);
    fireEvent.change(screen.getByLabelText(/paste notes/i), {
      target: { value: 'mi cuaderno de espanol' },
    });

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ ...analysis, status }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...analysis,
          status,
          coverage: status === 'PARTIAL' ? partialMaterialCoverage : completeMaterialCoverage,
        })
      );
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    await waitFor(() => expect(screen.getByText('B1')).toBeInTheDocument());
    return onVerify;
  }

  it('deduces and shows the level with both confirm options', async () => {
    await deduce();
    expect(screen.getByText('Uses past tense.')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 80%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start here/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /verify with a few questions/i })
    ).toBeInTheDocument();
  });

  it('"Start here" confirms and navigates to the learn hub', async () => {
    await deduce();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ courseId: 'course-1', level: 'B1', addedVocabulary: 5 }, true)
    );
    fireEvent.click(screen.getByRole('button', { name: /start here/i }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/learn'));
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const confirmation = calls.find(([url]) => url === '/api/v1/placement/from-notes/confirm');
    expect(JSON.parse(confirmation![1].body)).toMatchObject({
      analysisId,
      analysisRevision: 1,
      resultDigest,
      native: 'en',
      target: 'es',
      acceptPartial: false,
    });
  });

  it('"Verify" hands the deduced level back to the parent', async () => {
    const onVerify = await deduce();
    fireEvent.click(screen.getByRole('button', { name: /verify with a few questions/i }));
    expect(onVerify).toHaveBeenCalledWith('B1', {
      analysisId,
      analysisRevision: 1,
      resultDigest,
      acceptPartial: false,
    });
  });

  it('shows an error when the materials cannot be read', async () => {
    const onVerify = vi.fn();
    render(<NotesPlacement native="en" target="es" onVerify={onVerify} />);
    fireEvent.change(screen.getByLabelText(/paste notes/i), { target: { value: 'x' } });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'No readable materials uploaded' }, false));
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    await waitFor(() => expect(screen.getByText(/no readable materials/i)).toBeInTheDocument());
  });
  it('requires an explicit decision before confirming or verifying partial source coverage', async () => {
    const onVerify = await deduce('PARTIAL');
    expect(screen.getByText(/1 of 2 text chunks analyzed/i)).toBeInTheDocument();
    expect(screen.getByText(/Source 1, page 1: unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start here/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /verify with a few questions/i })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /reviewed the unresolved source coverage/i })
    );
    fireEvent.click(screen.getByRole('button', { name: /verify with a few questions/i }));
    expect(onVerify).toHaveBeenCalledWith('B1', {
      analysisId,
      analysisRevision: 1,
      resultDigest,
      acceptPartial: true,
    });
  });
  it('preserves the explicit retry identity after a lost response and verifies using the child receipt', async () => {
    const onVerify = await deduce('PARTIAL');
    const childId = '25bdc5bc-3987-4f5f-a4f6-41d6f2488be7';
    const counts = { inherited: 1, analyzed: 1, offlineReplay: 0, failed: 1, unstarted: 0 };
    const fetch = global.fetch as ReturnType<typeof vi.fn>;
    fetch.mockRejectedValueOnce(new Error('Synthetic lost retry response'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed chunks' }));
    expect(await screen.findByText('Synthetic lost retry response')).toBeInTheDocument();
    fetch
      .mockResolvedValueOnce(
        jsonResponse({
          analysisId: childId,
          analysisRevision: 1,
          status: 'RUNNING',
          identityDigest: analysis.identityDigest,
          resultDigest: null,
          statusUrl: `/api/v1/material-analyses/${childId}`,
          retryOfAnalysisId: analysisId,
          counts,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...analysis,
          analysisId: childId,
          resultDigest: 'b'.repeat(64),
          counts,
          coverage: completeMaterialCoverage,
        })
      );
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed chunks' }));
    await screen.findByText(/1 successful chunk reused/i);
    expect(fetch.mock.calls[4][1].body).toBe(fetch.mock.calls[5][1].body);
    fireEvent.click(screen.getByRole('button', { name: /verify with a few questions/i }));
    expect(onVerify).toHaveBeenCalledWith('B1', {
      analysisId: childId,
      analysisRevision: 1,
      resultDigest: 'b'.repeat(64),
      acceptPartial: false,
    });
  });
  it('clears the previous retry and estimate when edited sources fail admission', async () => {
    const fetch = global.fetch as ReturnType<typeof vi.fn>;
    fetch
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ ...analysis, status: 'RUNNING', resultDigest: null }))
      .mockResolvedValueOnce(
        jsonResponse({ ...analysis, status: 'FAILED', failureReason: 'Original analysis failed' })
      );
    render(<NotesPlacement native="en" target="es" onVerify={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/paste notes/i), {
      target: { value: 'Original source' },
    });
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    await screen.findByRole('button', { name: 'Retry failed chunks' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.change(screen.getByLabelText(/paste notes/i), {
      target: { value: 'Changed source' },
    });
    fetch
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'owner' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Changed source rejected' }, false));
    fireEvent.click(screen.getByRole('button', { name: /find my level/i }));
    expect(await screen.findByText('Changed source rejected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry failed chunks' })).not.toBeInTheDocument();
  });
});
