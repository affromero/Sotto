import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LegacyMaterialText } from '@/components/learn/course-materials/LegacyMaterialText';

const materialId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const url = (id = materialId) => `/api/v1/materials/${id}/legacy-text`;
const receipt = (
  offset = 0,
  text = 'Saved extract',
  totalCodePoints = [...text].length,
  nextOffset: number | null = null
) => ({
  materialId,
  origin: 'LEGACY_EMBEDDED_TEXT',
  offset,
  text,
  totalCodePoints,
  nextOffset,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('explicit bounded legacy material text windows', () => {
  it('reads exact Unicode windows on demand without retaining earlier text in the displayed window', async () => {
    const requested: URL[] = [];
    vi.stubGlobal('fetch', async (input: string, options?: RequestInit) => {
      const request = new URL(input, 'http://localhost');
      requested.push(request);
      expect(options?.cache).toBe('no-store');
      return Response.json(
        request.searchParams.get('offset') === '0'
          ? receipt(0, '😀'.repeat(8192), 8196, 8192)
          : receipt(8192, '終e\u0301!', 8196)
      );
    });
    render(<LegacyMaterialText materialId={materialId} url={url()} />);
    expect(
      screen.getByText(
        'Previously imported text. Page-by-page extraction coverage is unavailable for this older extract.'
      )
    ).toBeVisible();
    expect(requested).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Read imported text from start' }));
    await screen.findByText('😀'.repeat(8192));
    await userEvent.click(screen.getByRole('button', { name: 'Read next text section' }));
    await screen.findByText('終e\u0301!');
    expect(screen.queryByText('😀'.repeat(8192))).toBeNull();
    expect(
      requested.map((request) => [
        request.pathname,
        request.searchParams.get('offset'),
        request.searchParams.get('limit'),
      ])
    ).toEqual([
      [url(), '0', '8192'],
      [url(), '8192', '8192'],
    ]);
    expect(screen.queryByRole('button', { name: 'Read next text section' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Read imported text from start' })).toBeEnabled();
  });
  it.each([
    { materialId: otherId },
    { offset: 1 },
    { origin: 'EMBEDDED_TEXT' },
    { totalCodePoints: 30, nextOffset: 25 },
    { nextOffset: 13 },
  ])('rejects a text receipt with changed identity or inconsistent bounds: %j', async (changed) => {
    vi.stubGlobal('fetch', async () => Response.json({ ...receipt(), ...changed }));
    render(<LegacyMaterialText materialId={materialId} url={url()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read imported text from start' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Saved extract')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Read next text section' })).toBeNull();
  });
  it('rejects a different material link before sending a private text request', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      requests.push(input);
      return Response.json(receipt());
    });
    render(<LegacyMaterialText materialId={materialId} url={url(otherId)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read imported text from start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('link does not match this material');
    expect(requests).toEqual([]);
  });
  it('discards a late previous material body even when its fetch ignores cancellation', async () => {
    const body = Promise.withResolvers<unknown>();
    vi.stubGlobal('fetch', async (input: string) =>
      input.startsWith(url())
        ? ({ ok: true, json: () => body.promise } as Response)
        : Response.json({
            ...receipt(),
            materialId: otherId,
            text: 'New private text',
            totalCodePoints: 16,
          })
    );
    const view = render(<LegacyMaterialText materialId={materialId} url={url()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read imported text from start' }));
    await screen.findByRole('status');
    view.rerender(<LegacyMaterialText materialId={otherId} url={url(otherId)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read imported text from start' }));
    await screen.findByText('New private text');
    await act(async () => body.resolve(receipt(0, 'Private old text')));
    await waitFor(() => expect(screen.getByText('New private text')).toBeVisible());
    expect(screen.queryByText('Private old text')).toBeNull();
  });
});
