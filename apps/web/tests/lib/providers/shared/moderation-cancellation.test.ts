import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  fetch: vi.fn(),
  usage: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({ cache: { get: boundary.get, set: boundary.set } }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: boundary.usage }));
vi.mock('@/lib/codex-client', () => ({
  streamCodex: boundary.generate,
  isCodexCleanupError: () => false,
}));

describe('moderation cancellation', () => {
  const moderation = { fetch: boundary.fetch as typeof fetch };
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('OPENAI_MODERATION_KEY', 'fixture-key');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubGlobal('fetch', boundary.fetch);
    boundary.get.mockReset().mockResolvedValue(null);
    boundary.set.mockReset().mockResolvedValue(undefined);
    boundary.fetch.mockReset();
    boundary.usage.mockReset().mockResolvedValue(undefined);
    boundary.generate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stops waiting for a pending cache lookup and never starts the moderation request', async () => {
    let finish!: (value: null) => void;
    boundary.get.mockReturnValue(
      new Promise<null>((resolve) => {
        finish = resolve;
      })
    );
    const { moderateOrThrow } = await import('@/lib/moderation');
    const controller = new AbortController();
    const reason = new Error('Cancelled lookup');
    const pending = moderateOrThrow('Prompt', moderation, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    finish(null);
    await Promise.resolve();
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it('cancels the moderation request without treating cancellation as approval', async () => {
    let started!: () => void;
    const opened = new Promise<void>((resolve) => {
      started = resolve;
    });
    let stopped = false;
    boundary.fetch.mockImplementation(
      (url: string, options: RequestInit) =>
        new Promise<Response>((...callbacks) => {
          expect(url).toContain('/moderations');
          expect(options.body).toContain('Prompt');
          options.signal?.addEventListener(
            'abort',
            () => {
              stopped = true;
              callbacks[1](options.signal?.reason);
            },
            { once: true }
          );
          started();
        })
    );
    const { moderateOrThrow } = await import('@/lib/moderation');
    const controller = new AbortController();
    const reason = new Error('Cancelled moderation');
    const pending = moderateOrThrow('Prompt', moderation, controller.signal);
    await opened;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(stopped).toBe(true);
  });

  it('does not dispatch generation before moderation usage is durably persisted', async () => {
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const persisted = new Promise<void>((resolve) => {
      finish = resolve;
    });
    boundary.usage.mockImplementation(() => {
      started();
      return persisted;
    });
    boundary.generate.mockImplementation(async function* () {
      yield 'approved';
    });
    boundary.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              categories: {},
              category_scores: {},
              flagged: false,
            },
          ],
        })
      )
    );
    const { streamResponse } = await import('@/lib/llm');
    const stream = streamResponse('', [{ role: 'user', content: 'Prompt' }], {
      model: 'codex',
      moderation,
    });
    let settled = false;
    const pending = stream.next().finally(() => {
      settled = true;
    });
    await writing;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(boundary.generate).not.toHaveBeenCalled();
    finish();
    await expect(pending).resolves.toEqual({ done: false, value: 'approved' });
    expect(boundary.generate).toHaveBeenCalledTimes(1);
    await stream.return(undefined);
  });

  it('releases unsuccessful moderation response bodies', async () => {
    let cancelled = false;
    boundary.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 503 }
      )
    );
    const { moderateContent } = await import('@/lib/moderation');
    await expect(moderateContent('Prompt', moderation)).rejects.toThrow(
      'Moderation provider returned HTTP 503'
    );
    expect(cancelled).toBe(true);
  });

  it('closes a public LLM stream while moderation is pending', async () => {
    let started!: () => void;
    const opened = new Promise<void>((resolve) => {
      started = resolve;
    });
    let stopped = false;
    boundary.fetch.mockImplementation(
      (url: string, options: RequestInit) =>
        new Promise<Response>((...callbacks) => {
          expect(url).toContain('/moderations');
          options.signal?.addEventListener(
            'abort',
            () => {
              stopped = true;
              callbacks[1](options.signal?.reason);
            },
            { once: true }
          );
          started();
        })
    );
    const { streamResponse } = await import('@/lib/llm');
    const stream = streamResponse('', [{ role: 'user', content: 'Prompt' }], {
      model: 'codex',
      moderation,
    });
    const pending = stream.next().catch((error: unknown) => error);
    await opened;
    expect(await stream.return(undefined)).toMatchObject({ done: true });
    expect(await pending).toBeInstanceOf(Error);
    expect(stopped).toBe(true);
  });

  it('cancels moderation while reading the response body', async () => {
    let started!: () => void;
    const opened = new Promise<void>((resolve) => {
      started = resolve;
    });
    boundary.fetch.mockImplementation((url: string, options: RequestInit) => {
      expect(url).toContain('/moderations');
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              options.signal?.addEventListener(
                'abort',
                () => controller.error(options.signal?.reason),
                { once: true }
              );
              started();
            },
          })
        )
      );
    });
    const { moderateOrThrow } = await import('@/lib/moderation');
    const controller = new AbortController();
    const reason = new Error('Cancelled body');
    const pending = moderateOrThrow('Prompt', moderation, controller.signal);
    await opened;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('retains moderation decisions on completed responses', async () => {
    boundary.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              categories: { sexual: true },
              category_scores: { sexual: 0.9 },
              flagged: true,
            },
          ],
        })
      )
    );
    const { moderateOrThrow } = await import('@/lib/moderation');
    await expect(
      moderateOrThrow('Prompt', moderation, new AbortController().signal)
    ).rejects.toThrow('sexual');
    expect(boundary.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ flagged: true }),
      600
    );
  });
});
