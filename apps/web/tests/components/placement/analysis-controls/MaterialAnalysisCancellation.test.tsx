// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MaterialAnalysisCancellation } from '@/components/placement/analysis-controls/MaterialAnalysisCancellation';
import type { MaterialAnalysisProjection } from '@/lib/course-materials/client/analysis';

const analysisId = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
const analysis = (identityDigest: string | null = 'a'.repeat(64)): MaterialAnalysisProjection => ({
  analysisId,
  analysisRevision: 1,
  identityDigest,
  resultDigest: null,
  status: 'RUNNING',
  summary: null,
  coverage: null,
  stale: false,
});
function receipt(
  input: MaterialAnalysisProjection,
  verifiedUnits = 1,
  remainingUnits = 0,
  blockers: string[] = []
) {
  return {
    analysisId: input.analysisId,
    analysisRevision: input.analysisRevision,
    identityDigest: input.identityDigest,
    resultDigest: input.resultDigest,
    status: remainingUnits ? 'CANCELLING' : 'CANCELLED',
    statusUrl: `/api/v1/material-analyses/${input.analysisId}`,
    cancellation: {
      state: remainingUnits ? 'PENDING' : 'CANCELLED',
      verifiedUnits,
      remainingUnits,
      hasMore: blockers.length === 1 && blockers[0] === 'VERIFICATION_PENDING',
      blockers,
      operationId,
      operatorRecoveryUrl: null,
    },
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('owned analysis cancellation receipts', () => {
  it('replays the exact cancellation intent after a lost response', async () => {
    const input = analysis();
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
      expect(new Headers(options?.headers).get('x-sotto-expected-profile-id')).toBe('owner');
      bodies.push(String(options?.body));
      if (bodies.length === 1) throw new TypeError('Synthetic response loss');
      return Response.json(receipt(input));
    });
    render(<MaterialAnalysisCancellation analysis={input} expectedProfileId="owner" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
    await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: 'Cancel source analysis' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByText(/known work and cleanup are verified/);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0])).toMatchObject({
      analysisRevision: 1,
      identityDigest: input.identityDigest,
      resultDigest: null,
    });
  });
  it('continues only eight known-proof pages per action and resumes the same intent on the next explicit check', async () => {
    const input = analysis();
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
      bodies.push(String(options?.body));
      return Response.json(
        bodies.length <= 8
          ? receipt(input, bodies.length * 64, (9 - bodies.length) * 64, ['VERIFICATION_PENDING'])
          : receipt(input, 576)
      );
    });
    render(<MaterialAnalysisCancellation analysis={input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
    await screen.findByText(/More saved cleanup proofs remain/);
    const check = screen.getByRole('button', { name: 'Check cancellation status' });
    await waitFor(() => expect(check).toBeEnabled());
    expect(bodies).toHaveLength(8);
    fireEvent.click(check);
    await screen.findByText(/known work and cleanup are verified/);
    expect(bodies).toHaveLength(9);
    expect(new Set(bodies).size).toBe(1);
  });
  it('stops automatic continuation when the provider outcome remains unknown', async () => {
    const input = analysis();
    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
      bodies.push(String(options?.body));
      return Response.json(receipt(input, 0, 1, ['PROVIDER_UNKNOWN']));
    });
    render(<MaterialAnalysisCancellation analysis={input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
    await screen.findByText(/provider outcome or cleanup is still unconfirmed/);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check cancellation status' })).toBeEnabled()
    );
    expect(bodies).toHaveLength(1);
    expect(screen.queryByText(/known work and cleanup are verified/)).toBeNull();
  });
  it.each(['analysisId', 'analysisRevision', 'identityDigest', 'resultDigest'] as const)(
    'rejects a cancellation receipt with a different %s before continuation',
    async (field) => {
      const input = analysis();
      const wrong = {
        ...receipt(input, 64, 64, ['VERIFICATION_PENDING']),
        [field]:
          field === 'analysisRevision' ? 2 : field === 'analysisId' ? randomUUID() : 'b'.repeat(64),
      };
      const bodies: string[] = [];
      vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
        if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
        bodies.push(String(options?.body));
        return Response.json(wrong);
      });
      render(<MaterialAnalysisCancellation analysis={input} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'does not match this source analysis'
      );
      expect(bodies).toHaveLength(1);
      expect(screen.queryByText(/known work and cleanup are verified/)).toBeNull();
    }
  );
  it('starts a fresh intent only after the observed receipt changes and rejects a mismatched active profile', async () => {
    const first = analysis(null);
    const later = analysis();
    const bodies: string[] = [];
    let profile = 'owner';
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url === '/api/v1/users/me') return Response.json({ id: profile });
      bodies.push(String(options?.body));
      return bodies.length === 1
        ? Response.json({ error: 'Receipt changed' }, { status: 409 })
        : Response.json(receipt(later));
    });
    const view = render(
      <MaterialAnalysisCancellation analysis={first} expectedProfileId="owner" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
    await screen.findByRole('alert');
    view.rerender(<MaterialAnalysisCancellation analysis={later} expectedProfileId="owner" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
    await screen.findByText(/known work and cleanup are verified/);
    expect(JSON.parse(bodies[1]).identityDigest).toBe(later.identityDigest);
    expect(JSON.parse(bodies[1]).requestId).not.toBe(JSON.parse(bodies[0]).requestId);
    profile = 'another-owner';
    view.rerender(
      <MaterialAnalysisCancellation
        analysis={{ ...later, analysisRevision: 2 }}
        expectedProfileId="owner"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel source analysis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('active learner changed');
    expect(bodies).toHaveLength(2);
  });
});
