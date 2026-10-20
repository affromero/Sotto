import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MaterialProcessingPanel } from '@/components/course-materials/MaterialProcessingPanel';

const materialId = 'd590f44a-b360-4a93-88fe-b83740411109';
const runId = '713124af-427d-4d61-8d23-b9baedcc7197';
const hash = 'a'.repeat(64);
const evidence = {
  assessor: { method: 'owned-recognition', version: '1' },
  pageImageSha256: hash,
  extent: 'FULL_PAGE',
  diagnostic: 'Owned synthetic page assessment.',
};
const manifest = {
  schemaVersion: 1,
  pageNumber: 65,
  source: { origin: 'EMBEDDED_TEXT', method: 'owned-extractor', version: '1' },
  textSha256: hash,
  codePointLength: 9,
  utf8ByteLength: 15,
  chunkCount: 2,
  hasNonWhitespace: true,
};
function processing(overrides: Record<string, unknown> = {}) {
  return {
    materialId,
    processingRevision: 1,
    originalSha256: hash,
    status: 'PARTIAL',
    diagnostic: null,
    optimization: null,
    run: { id: runId, status: 'PARTIAL', pageCount: 65 },
    pages: Array.from({ length: 65 }, (_, index) => ({
      pageNumber: index + 1,
      embeddedText: { state: 'EXTRACTED' },
      visual: index === 64 ? { state: 'UNCERTAIN', ...evidence } : { state: 'UNASSESSED' },
      recognition: null,
      textStreams: index === 64 ? [{ id: 'owned-stream', ...manifest }] : [],
    })),
    nextPage: null,
    ...overrides,
  };
}
const options = {
  capabilitySha256: hash,
  provider: 'owned-provider',
  model: 'owned-configured-model',
  minimumDpi: 144,
  maximumImageBytes: 2000000,
  expectedProcessingRevision: 1,
  maximumPageRequests: 65,
  diagnostic: 'One configured request for each supported page.',
};
const json = (value: unknown, status = 200) => Response.json(value, { status });
const panel = () =>
  render(
    <MaterialProcessingPanel
      materialId={materialId}
      name="Owned 65-page class.pdf"
      mimeType="application/pdf"
    />
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('private material processing ledger', () => {
  it('distinguishes every visual coverage state and preserves its diagnostic', async () => {
    const visuals = [
      { state: 'UNASSESSED' },
      { state: 'UNAVAILABLE', diagnostic: 'Owned missing renderer.' },
      { state: 'TEXT_SOURCE', originalSha256: hash, diagnostic: 'Owned complete text source.' },
      ...['RECOGNITION_NEEDED', 'TEXT_COVERED', 'RECOGNIZED', 'BLANK', 'UNCERTAIN'].map(
        (state) => ({ state, ...evidence })
      ),
      { state: 'FAILED', ...evidence, pageImageSha256: null },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          processing({
            pages: visuals.map((visual, index) => ({
              pageNumber: index + 1,
              embeddedText: { state: 'PENDING' },
              visual,
              recognition: null,
              textStreams: [],
            })),
          })
        )
      )
    );
    panel();
    for (const label of [
      'Visual content not assessed',
      'Visual recognition unavailable',
      'Complete text source',
      'Visual recognition needed',
      'Visible text covered',
      'Visual content recognized',
      'Assessed as blank',
      'Recognition has uncertainty',
      'Visual recognition failed',
    ])
      expect(await screen.findByText(label)).toBeVisible();
    expect(screen.getByText('Owned missing renderer.')).toBeVisible();
  });
  it('keeps the chosen recognition transcript when an older embedded-text response arrives late', async () => {
    let finishEmbedded: ((value: Response) => void) | undefined;
    const visualManifest = {
      ...manifest,
      source: { ...manifest.source, origin: 'VISUAL_RECOGNITION' },
    };
    const page = processing().pages[64];
    page.textStreams.push({ ...visualManifest, id: 'visual-stream' });
    const value = processing({ pages: [page] });
    const response = (origin: string, text: string) =>
      json({
        runId,
        manifest: origin === 'EMBEDDED_TEXT' ? manifest : visualManifest,
        chunks: [
          {
            index: 0,
            codePointStart: 0,
            codePointEnd: text.length,
            utf8ByteStart: 0,
            utf8ByteEnd: text.length,
            sha256: hash,
            text,
          },
        ],
        nextIndex: null,
      });
    const fetch = vi.fn().mockImplementation(async (resource: string) => {
      if (!resource.includes('/text?')) return json(value);
      if (resource.includes('origin=VISUAL_RECOGNITION'))
        return response('VISUAL_RECOGNITION', 'Chosen transcript');
      return new Promise<Response>((resolve) => {
        finishEmbedded = resolve;
      });
    });
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect page 65 text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read embedded text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read recognition transcript' }));
    expect(await screen.findByText('Chosen transcript')).toBeVisible();
    await act(async () => {
      finishEmbedded?.(response('EMBEDDED_TEXT', 'Stale embedded text'));
    });
    expect(screen.queryByText('Stale embedded text')).not.toBeInTheDocument();
    expect(screen.getByText('Chosen transcript')).toBeVisible();
  });

  it('keeps a freshly read processing revision when an older pagination response arrives late', async () => {
    let finishPagination: ((value: Response) => void) | undefined;
    let reads = 0;
    const fetch = vi.fn().mockImplementation(async (resource: string) => {
      if (resource.includes('afterPage='))
        return new Promise<Response>((resolve) => {
          finishPagination = resolve;
        });
      return json(
        reads++ === 0 ? processing({ nextPage: 65 }) : processing({ processingRevision: 2 })
      );
    });
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Read more page states' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh processing' }));
    expect(await screen.findByText(/Revision 2/)).toBeVisible();
    await act(async () => {
      finishPagination?.(
        json(processing({ pages: [{ ...processing().pages[0], pageNumber: 66 }], nextPage: null }))
      );
    });
    expect(screen.getByText(/Revision 2/)).toBeVisible();
    expect(screen.queryByText('Page 66')).not.toBeInTheDocument();
  });
  it('polls canonical EXTRACTING status and stops after a retained terminal result', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          processing({
            status: 'EXTRACTING',
            run: { id: runId, status: 'EXTRACTING', pageCount: 65 },
            pages: [],
          })
        )
      )
      .mockResolvedValue(json(processing()));
    vi.stubGlobal('fetch', fetch);
    panel();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/Revision 1 · extracting/)).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByText('Page 65')).toBeVisible();
    const terminalRequests = fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(fetch.mock.calls.length).toBe(terminalRequests);
  });

  it('aborts the status reader on unmount without cancelling or replacing durable work', async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn().mockImplementation((_resource: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetch);
    const view = panel();
    expect(screen.getByRole('status')).toHaveTextContent('Reading retained material status');
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it('keeps the final page and Unicode text windows visible without inferring blank pages', async () => {
    const fetch = vi.fn().mockImplementation(async (resource: string) => {
      if (resource.includes('/text?'))
        return json({
          runId,
          manifest,
          chunks: [
            {
              index: 0,
              codePointStart: 0,
              codePointEnd: 5,
              utf8ByteStart: 0,
              utf8ByteEnd: 11,
              sha256: hash,
              text: '\uFEFF😀e\u0301\0',
            },
          ],
          nextIndex: 0,
        });
      return json(processing());
    });
    vi.stubGlobal('fetch', fetch);
    panel();
    expect(await screen.findByText('Page 65')).toBeVisible();
    expect(screen.getByText('Recognition has uncertainty')).toBeVisible();
    expect(screen.queryByText('Assessed as blank')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect page 65 text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read embedded text' }));
    expect(await screen.findByText(/Showing 0 to 5/)).toBeVisible();
    expect(document.querySelector('pre')?.textContent).toBe('\uFEFF😀e\u0301\0');
    expect(screen.getByRole('button', { name: 'Read next text chunks' })).toBeEnabled();
    expect(fetch.mock.calls.some(([resource]) => String(resource).includes(`runId=${runId}`))).toBe(
      true
    );
  });

  it('never offers an optimized download without a matching successful original receipt', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json(processing({ optimization: { status: 'OPTIMIZED', originalSha256: 'b'.repeat(64) } }))
      );
    vi.stubGlobal('fetch', fetch);
    panel();
    expect(await screen.findByRole('link', { name: 'Download original' })).toHaveAttribute(
      'href',
      `/api/v1/materials/${materialId}/file?variant=original`
    );
    expect(
      screen.queryByRole('link', { name: 'Download verified optimized PDF' })
    ).not.toBeInTheDocument();
    fetch.mockResolvedValue(
      json(
        processing({ optimization: { status: 'OPTIMIZED', originalSha256: hash, savedBytes: 100 } })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh processing' }));
    expect(
      await screen.findByRole('link', { name: 'Download verified optimized PDF' })
    ).toHaveAttribute('href', `/api/v1/materials/${materialId}/file?variant=optimized`);
  });

  it('requires a reviewed configured selection and explicit charge consent, then replays an interrupted POST unchanged', async () => {
    let submitted: string | null = null,
      interrupted = true;
    const fetch = vi.fn().mockImplementation(async (resource: string, init?: RequestInit) => {
      if (resource.endsWith('/recognize') && init?.method === 'POST') {
        if (submitted === null) submitted = String(init.body);
        else expect(init.body).toBe(submitted);
        if (interrupted) {
          interrupted = false;
          throw new Error('Synthetic interrupted admission response');
        }
        const input = JSON.parse(String(init.body)) as { requestId: string };
        return json(
          {
            materialId,
            runId,
            processingRevision: 2,
            requestId: input.requestId,
            status: 'PENDING',
          },
          202
        );
      }
      if (resource.endsWith('/recognize')) return json(options);
      return json(processing());
    });
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Review configured recognition' }));
    expect(await screen.findByText('owned-provider / owned-configured-model')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start reviewed page recognition' })).toBeDisabled();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /authorize recognition/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start reviewed page recognition' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved request');
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved recognition request' }));
    expect(await screen.findByText(/Recognition admitted as processing revision 2/)).toBeVisible();
  });

  it('starts a newly reviewed revision with a fresh request only after the prior acknowledgement was verified', async () => {
    let revision = 1;
    const submitted: Array<{ requestId: string; expectedProcessingRevision: number }> = [];
    vi.stubGlobal('fetch', async (resource: string, init?: RequestInit) => {
      if (resource.endsWith('/recognize') && init?.method === 'POST') {
        const input = JSON.parse(String(init.body));
        submitted.push(input);
        revision = input.expectedProcessingRevision + 1;
        return json(
          {
            materialId,
            runId,
            processingRevision: revision,
            requestId: input.requestId,
            status: 'PENDING',
          },
          202
        );
      }
      if (resource.endsWith('/recognize'))
        return json({ ...options, expectedProcessingRevision: revision });
      return json(processing({ processingRevision: revision }));
    });
    panel();
    for (const expected of [1, 2]) {
      fireEvent.click(await screen.findByRole('button', { name: 'Review configured recognition' }));
      await screen.findByText('owned-provider / owned-configured-model');
      fireEvent.click(screen.getByRole('checkbox', { name: /authorize recognition/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Start reviewed page recognition' }));
      await screen.findByText(
        new RegExp(`Recognition admitted as processing revision ${expected + 1}`)
      );
    }
    expect(submitted.map((request) => request.expectedProcessingRevision)).toEqual([1, 2]);
    expect(submitted[0]!.requestId).not.toBe(submitted[1]!.requestId);
  });

  it('surfaces unavailable recognition without selecting another model or making a POST', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async (resource: string) =>
        resource.endsWith('/recognize')
          ? json({ error: 'Configured model has no operator review.' }, 400)
          : json(processing())
      );
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Review configured recognition' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Configured model has no operator review.'
    );
    expect(
      screen.getByRole('link', { name: 'Owner recognition capability settings' })
    ).toHaveAttribute('href', '/admin/providers#material-recognition');
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('blocks fresh page calls when a provider outcome is unknown', async () => {
    const value = processing({
      status: 'RECOVERY_REQUIRED',
      run: { id: runId, status: 'RECOVERY_REQUIRED', pageCount: 1 },
      pages: [
        {
          pageNumber: 1,
          embeddedText: { state: 'FAILED', diagnostic: 'Owned extraction error.' },
          visual: { state: 'UNAVAILABLE', diagnostic: 'No render receipt.' },
          recognition: { id: runId, mode: 'CLI', status: 'UNKNOWN' },
          textStreams: [],
        },
      ],
    });
    const fetch = vi.fn().mockResolvedValue(json(value));
    vi.stubGlobal('fetch', fetch);
    panel();
    expect(await screen.findByRole('alert')).toHaveTextContent('provider outcome is unknown');
    expect(screen.getByRole('button', { name: 'Review configured recognition' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Try lossless PDF compression' })).toBeDisabled();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows an optimization failure while preserving the original download', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async (resource: string) =>
        resource.endsWith('/optimize')
          ? json({ error: 'Owned optimization admission error.' }, 409)
          : json(processing())
      );
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Try lossless PDF compression' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Owned optimization admission error.'
    );
    expect(screen.getByRole('link', { name: 'Download original' })).toBeVisible();
  });

  it('rejects page pagination that crosses the immutable processing run', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(processing({ nextPage: 65 })))
      .mockResolvedValueOnce(
        json(processing({ processingRevision: 2, pages: [], nextPage: null }))
      );
    vi.stubGlobal('fetch', fetch);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Read more page states' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('processing run changed');
    expect(
      within(screen.getByRole('region', { name: /Processing Owned/ })).getByText('Page 65')
    ).toBeVisible();
  });
});
