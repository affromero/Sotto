import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MaterialRecognitionCapabilities } from '@/components/course-materials/MaterialRecognitionCapabilities';

const providers = [
  {
    id: 'owned-provider',
    displayName: 'Owned provider',
    models: [{ id: 'owned-model', displayName: 'Owned model' }],
  },
];
const capability = {
  schemaVersion: 1,
  source: 'REVIEWED_MODEL_CAPABILITY',
  reviewId: 'owned-review',
  revision: '1',
  provider: 'owned-provider',
  model: 'owned-model',
  endpoint: null,
  vision: true,
  handwriting: true,
  maxImages: 5,
  maxDecodedBytes: 2000000,
  minimumDpi: 144,
  maxOutputTokens: 16384,
};
const record = { capability, documentationUrl: 'https://example.com/owned-model', active: true };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const panel = () => render(<MaterialRecognitionCapabilities providers={providers} />);
function fill() {
  for (const [label, value] of [
    ['Provider', 'owned-provider'],
    ['Exact model ID', 'owned-model'],
    ['Model documentation URL', 'https://example.com/owned-model'],
    ['Review ID', 'owned-review'],
    ['Review version', '1'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
describe('owner recognition capability reviews', () => {
  it('saves only an explicitly confirmed exact review using the observed registry revision', async () => {
    let body: unknown;
    const fetch = vi.fn().mockImplementation(async (_resource: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        body = JSON.parse(String(init.body));
        return Response.json({ revision: 8, capabilities: [record] });
      }
      return Response.json({ revision: 7, capabilities: [] });
    });
    vi.stubGlobal('fetch', fetch);
    panel();
    expect(await screen.findByText(/No reviewed recognition capabilities/)).toBeVisible();
    fill();
    expect(screen.getByRole('button', { name: 'Save reviewed capability' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the documentation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed capability' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Capability review saved');
    expect(body).toEqual({
      expectedRevision: 7,
      operatorConfirmed: true,
      capability,
      documentationUrl: record.documentationUrl,
    });
    expect(
      fetch.mock.calls.every(
        ([resource]) => resource === '/api/v1/admin/material-recognition-capabilities'
      )
    ).toBe(true);
  });

  it('surfaces a conflicting owner registry revision without silently rebasing the write', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ revision: 7, capabilities: [record] }))
      .mockResolvedValueOnce(
        Response.json({ error: 'Registry changed. Refresh first.' }, { status: 409 })
      );
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke owned-review 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registry changed');
    expect(screen.getByText(/Review owned-review, version 1 · Active/)).toBeVisible();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });

  it('replays a lost review response with identical version and expected revision', async () => {
    const sent: string[] = [];
    const fetch = vi.fn().mockImplementation(async (_resource: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json({ revision: 1, capabilities: [] });
      sent.push(String(init.body));
      if (sent.length === 1) throw new Error('Synthetic lost registry response');
      return Response.json({ revision: 2, capabilities: [record] });
    });
    vi.stubGlobal('fetch', fetch);
    panel();
    expect(await screen.findByText(/No reviewed recognition capabilities/)).toBeVisible();
    fill();
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed the documentation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed capability' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saved registry request' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Capability review saved');
    expect(sent[1]).toBe(sent[0]);
  });

  it('shows owner authorization failure without capability write controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }))
    );
    panel();
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(
      screen.queryByRole('button', { name: 'Save reviewed capability' })
    ).not.toBeInTheDocument();
  });
});
