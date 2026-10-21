// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import type { CapturedLearningAi } from '@/lib/learning-ai';
import {
  MATERIAL_RECOGNITION_LIMITS,
  MaterialRecognitionUnsupported,
  materialRecognitionSelection,
  materialRecognitionHash,
  rebuildMaterialRecognitionInput,
  materialRecognitionTilesCoverPage,
  materialRecognitionGrantSpec,
  parseMaterialTranscription,
  prepareMaterialRecognition,
  type MaterialRecognitionCapability,
  type MaterialRecognitionSource,
  type PreparedMaterialRecognition,
} from '@/lib/course-materials/recognition/protocol';
import {
  executeMaterialRecognitionHttp,
  replayMaterialRecognitionHttp,
  executeMaterialRecognitionCli,
  replayMaterialRecognitionCli,
  MaterialRecognitionExecutionError,
  type MaterialRecognitionHttpOperation,
  type MaterialRecognitionHttpReceipt,
  type MaterialRecognitionCliOperation,
  type MaterialRecognitionCliReceipt,
} from '@/lib/course-materials/recognition/execute';
import {
  learningPreparationProviderRequest,
  restoreLearningPreparationResponse,
  type LearningPreparationResponseReceipt,
} from '@/lib/learning/preparation/preparation-provider';

const boundary = vi.hoisted(() => ({
  network: vi.fn(),
  cli: vi.fn(),
  transaction: {},
  raiseOutputBudget: false,
}));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));
vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: async (_database: unknown, operation: (database: object) => Promise<unknown>) =>
    operation(boundary.transaction),
}));
vi.mock('@/lib/server-config', () => ({
  getServerInfra: async () => ({}),
  infra: () => undefined,
}));
vi.mock('@/lib/learning-ai', () => ({
  capturedLearningAiOptions: async (ai: CapturedLearningAi) => ({
    model: ai.model,
    endpoint: ai.endpoint,
    apiKeyOverride: 'owned-fixture-key',
    signal: ai.execution.signal,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let request = new Request(input, init);
      if (boundary.raiseOutputBudget) {
        const payload = await request.clone().json();
        payload.max_completion_tokens = 99_999;
        request = new Request(request, { body: JSON.stringify(payload) });
      }
      if (!ai.execution.providerRequest) throw new Error('Missing test attempt boundary.');
      return ai.execution.providerRequest(request, () => boundary.network(request));
    },
  }),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  captureSottoProviderAdmission: async () => ({
    validate: async (signal: AbortSignal) => signal.throwIfAborted(),
  }),
}));
vi.mock('@/lib/codex-client', () => ({
  executeCodex: (...args: unknown[]) => boundary.cli(...args),
}));
vi.mock('openai', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(`${process.cwd()}/package.json`)('openai') };
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKm0AAAAASUVORK5CYII=',
  'base64'
);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const signal = () => new AbortController().signal;
function ai(provider = 'local'): CapturedLearningAi {
  return {
    provider,
    model: provider === 'local' ? 'local:owned-vision-fixture' : 'codex:owned-fixture',
    ...(provider === 'local' ? { endpoint: 'http://127.0.0.1:9999/v1' } : {}),
    execution: { userId: 'profile-owned', authorize: async () => ({ userId: 'profile-owned' }) },
  };
}
function capability(selected = ai()): MaterialRecognitionCapability {
  return {
    schemaVersion: 1,
    source: 'REVIEWED_MODEL_CAPABILITY',
    reviewId: 'owned-test-review',
    revision: 'review-v1',
    provider: selected.provider,
    model: selected.model,
    endpoint: selected.endpoint ?? null,
    vision: true,
    handwriting: true,
    maxImages: 5,
    maxDecodedBytes: 2_000_000,
    minimumDpi: 150,
    maxOutputTokens: 1024,
  };
}
function source(): MaterialRecognitionSource {
  return {
    schemaVersion: 1,
    runtimeRevision: 'owned-runtime-v1',
    material: {
      id: 'material-owned',
      userId: 'profile-owned',
      generation: 1_700_000_000_000,
      ownerGeneration: 1_600_000_000_000,
      processingRevision: 1,
      originalSha256: 'a'.repeat(64),
    },
    page: { number: 65, width: 1, height: 1, imageSha256: sha(png) },
    renderer: {
      method: 'owned-png-renderer',
      version: '1',
      dpi: 150,
      rotation: '0',
      includeAnnotations: true,
      background: 'WHITE',
      format: 'PNG',
    },
    tiles: [{ index: 0, x: 0, y: 0, width: 1, height: 1, imageSha256: sha(png) }],
  };
}
function prepared(selected = ai()) {
  return prepareMaterialRecognition({
    ai: selected,
    capability: capability(selected),
    source: source(),
    images: [{ index: 0, bytes: png }],
  });
}
function transcription(input: PreparedMaterialRecognition) {
  return {
    schemaVersion: 1,
    inputDigest: input.inputDigest,
    pageNumber: 65,
    tiles: [
      {
        index: 0,
        state: 'TRANSCRIBED',
        fullVisibleCoverage: true,
        hasHandwriting: true,
        transcription: 'werde\nwürde? e\u0301 🙂',
        uncertainties: [],
      },
    ],
  };
}
function providerResponse(content: unknown) {
  return Response.json({
    id: 'owned-response',
    object: 'chat.completion',
    created: 1,
    model: 'owned-vision-fixture',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: typeof content === 'string' ? content : JSON.stringify(content),
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}
function journal(input: PreparedMaterialRecognition) {
  const state: {
    outcome: string | null;
    http: MaterialRecognitionHttpReceipt | null;
    cli: MaterialRecognitionCliReceipt | null;
    admitted: boolean;
    rejectSave: boolean;
    unresolved: boolean;
  } = {
    outcome: null,
    http: null,
    cli: null,
    admitted: false,
    rejectSave: false,
    unresolved: false,
  };
  const admit: MaterialRecognitionHttpOperation['admit'] = async () => {
    if (state.admitted) return { dispatch: false };
    state.admitted = true;
    return { dispatch: true };
  };
  const http: MaterialRecognitionHttpOperation = {
    admit,
    settle: async (_database, attempt, outcome, response) => {
      if (state.rejectSave && outcome === 'succeeded')
        throw new Error('Transaction rejected response receipt.');
      state.outcome = outcome;
      if (response) state.http = { inputDigest: input.inputDigest, attempt, response };
    },
  };
  const cli: MaterialRecognitionCliOperation = {
    admit,
    validateBinding: async (_database, expected) => {
      if (expected.fingerprint !== 'b'.repeat(64)) throw new Error('Account binding changed.');
    },
    settle: async (_database, _attempt, outcome, receipt) => {
      if (state.rejectSave && outcome === 'succeeded')
        throw new Error('Transaction rejected CLI receipt.');
      state.outcome = outcome;
      if (receipt) state.cli = receipt;
    },
  };
  return {
    state,
    http,
    cli,
    unresolved: () => {
      state.unresolved = true;
    },
  };
}
const cliBinding = {
  kind: 'LOCAL_ACCOUNT' as const,
  fingerprint: 'b'.repeat(64),
  revision: 'account-config-v1',
};
beforeEach(() => {
  boundary.network.mockReset();
  boundary.cli.mockReset();
  boundary.raiseOutputBudget = false;
  vi.stubEnv('CODEX_SSH_HOST', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('material recognition identity and explicit coverage', () => {
  it('pins exact page, original, renderer, tile, reviewed model and authority metadata', () => {
    const original = prepared();
    expect(original.selection.credentialFingerprint).toBeNull();
    expect(original.selection.credentialRevision).toBeNull();
    const mutations: ((input: MaterialRecognitionSource) => void)[] = [
      (input) => {
        input.page.number = 64;
      },
      (input) => {
        input.material.originalSha256 = 'c'.repeat(64);
      },
      (input) => {
        input.renderer.version = '2';
      },
      (input) => {
        input.material.processingRevision += 1;
      },
      (input) => {
        input.material.ownerGeneration += 1;
      },
    ];
    for (const mutate of mutations) {
      const changed = source();
      mutate(changed);
      expect(
        prepareMaterialRecognition({
          ai: ai(),
          capability: capability(),
          source: changed,
          images: [{ index: 0, bytes: png }],
        }).inputDigest
      ).not.toBe(original.inputDigest);
    }
    expect(
      materialRecognitionSelection(ai(), { ...capability(), revision: 'review-v2' })
        .capabilitySha256
    ).not.toBe(original.selection.capabilitySha256);
  });
  it('rejects capability mismatch, low resolution, changed PNGs and unreadable byte budgets before dispatch', () => {
    expect(() =>
      prepareMaterialRecognition({
        ai: ai(),
        capability: { ...capability(), model: 'different-selected-model' },
        source: source(),
        images: [{ index: 0, bytes: png }],
      })
    ).toThrow('capability');
    const low = source();
    low.renderer.dpi = 72;
    expect(() =>
      prepareMaterialRecognition({
        ai: ai(),
        capability: capability(),
        source: low,
        images: [{ index: 0, bytes: png }],
      })
    ).toThrow(MaterialRecognitionUnsupported);
    expect(() =>
      prepareMaterialRecognition({
        ai: ai(),
        capability: capability(),
        source: source(),
        images: [{ index: 0, bytes: Buffer.concat([png, Buffer.from('changed')]) }],
      })
    ).toThrow('digest');
    expect(() =>
      prepareMaterialRecognition({
        ai: ai(),
        capability: { ...capability(), maxDecodedBytes: png.length - 1 },
        source: source(),
        images: [{ index: 0, bytes: png }],
      })
    ).toThrow('budget');
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('enforces Codex five-image and combined decoded-byte admission without downsampling', () => {
    const selected = ai('codex');
    const six = source();
    six.tiles = Array.from({ length: 6 }, (_, index) => ({ ...six.tiles[0]!, index }));
    expect(() =>
      prepareMaterialRecognition({
        ai: selected,
        capability: capability(selected),
        source: six,
        images: six.tiles.map((tile) => ({ index: tile.index, bytes: png })),
      })
    ).toThrow();
    const large = Buffer.alloc(MATERIAL_RECOGNITION_LIMITS.decodedBytes + 1);
    png.copy(large);
    const tooLarge = source();
    tooLarge.page.imageSha256 = sha(large);
    tooLarge.tiles[0]!.imageSha256 = sha(large);
    expect(() =>
      prepareMaterialRecognition({
        ai: selected,
        capability: capability(selected),
        source: tooLarge,
        images: [{ index: 0, bytes: large }],
      })
    ).toThrow('budget');
  });
  it('preserves transcription Unicode, spelling and separate uncertainty rather than silently correcting notes', () => {
    const input = prepared();
    expect(
      parseMaterialTranscription(input, JSON.stringify(transcription(input))).tiles[0]!
        .transcription
    ).toBe('werde\nwürde? e\u0301 🙂');
    const uncertain = transcription(input);
    const value = {
      ...uncertain,
      tiles: [
        {
          ...uncertain.tiles[0]!,
          state: 'UNCERTAIN',
          fullVisibleCoverage: false,
          uncertainties: [
            {
              region: { x: 0, y: 0, width: 1, height: 1 },
              reason: 'AMBIGUOUS',
              detail: 'The handwritten vowel is unclear.',
              codePointStart: 0,
              codePointEnd: 1,
            },
          ],
        },
      ],
    };
    expect(parseMaterialTranscription(input, JSON.stringify(value)).tiles[0]!.state).toBe(
      'UNCERTAIN'
    );
  });
  it('never promotes empty output to blank or omits a requested tile', () => {
    const input = prepared();
    const value = transcription(input);
    for (const altered of [
      { ...value, tiles: [] },
      { ...value, tiles: [{ ...value.tiles[0]!, transcription: '' }] },
      { ...value, inputDigest: 'c'.repeat(64) },
      { ...value, pageNumber: 1 },
    ])
      expect(() => parseMaterialTranscription(input, JSON.stringify(altered))).toThrow();
    const blank = {
      ...value,
      tiles: [{ ...value.tiles[0]!, state: 'BLANK', transcription: '', hasHandwriting: false }],
    };
    expect(parseMaterialTranscription(input, JSON.stringify(blank)).tiles[0]!.state).toBe('BLANK');
  });
  it('detects full-page gaps and allows overlapping retained tiles without counting area twice', () => {
    const page = { ...source().page, width: 10, height: 10 };
    const tile = source().tiles[0]!;
    expect(
      materialRecognitionTilesCoverPage(page, [
        { ...tile, width: 6, height: 10 },
        { ...tile, index: 1, x: 4, width: 6, height: 10 },
      ])
    ).toBe(true);
    expect(
      materialRecognitionTilesCoverPage(page, [
        { ...tile, width: 4, height: 10 },
        { ...tile, index: 1, x: 5, width: 5, height: 10 },
      ])
    ).toBe(false);
    expect(() =>
      materialRecognitionTilesCoverPage(page, [{ ...tile, width: 11, height: 10 }])
    ).toThrow();
  });
  it('pins one real delegation grant request to the material and profile generations', () => {
    const grant = materialRecognitionGrantSpec({
      id: '00000000-0000-4000-8000-000000000001',
      revision: '00000000-0000-4000-8000-000000000002',
      instanceId: '00000000-0000-4000-8000-000000000003',
      expiresAt: Date.now() + 60_000,
      source: source(),
      identityDigest: prepared().inputDigest,
    });
    expect(grant).toMatchObject({
      maxRequests: 1,
      subject: { id: 'profile:profile-owned', generation: source().material.ownerGeneration },
      resource: { id: 'material:material-owned', generation: source().material.generation },
    });
    expect(grant.action).toBe(`material-recognition:${prepared().inputDigest}`);
  });
});

describe('durable material recognition execution', () => {
  it('saves the bounded raw HTTP response with success and replays canonical parsing after a crash', async () => {
    const input = prepared();
    const record = journal(input);
    boundary.network.mockImplementation(async () => providerResponse(transcription(input)));
    const result = await executeMaterialRecognitionHttp({
      ai: ai(),
      prepared: input,
      operation: record.http,
      signal: signal(),
      unresolved: record.unresolved,
    });
    expect(record.state.outcome).toBe('succeeded');
    expect(record.state.http?.response.bodySha256).toHaveLength(64);
    boundary.network.mockImplementation(async () => {
      throw new Error('Replay must not dispatch.');
    });
    const replay = await replayMaterialRecognitionHttp({
      prepared: input,
      receipt: record.state.http!,
      signal: signal(),
    });
    expect(replay).toEqual(result);
    expect(boundary.network).toHaveBeenCalledTimes(1);
  });
  it('retains unknown outcomes and prevents redispatch after a network interruption', async () => {
    const input = prepared();
    const record = journal(input);
    boundary.network.mockRejectedValue(new Error('Connection dropped after dispatch.'));
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'UNKNOWN' });
    expect(record.state).toMatchObject({ outcome: 'unknown', unresolved: true, http: null });
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'NOT_DISPATCHED' });
    expect(boundary.network).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch another paid request when provider wrappers try an HTTP retry', async () => {
    const input = prepared();
    const record = journal(input);
    boundary.network.mockImplementation(async () =>
      Response.json({ error: { message: 'Temporary failure.' } }, { status: 503 })
    );
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'FAILED' });
    expect(record.state.outcome).toBe('failed');
    expect(record.state.http?.response.status).toBe(503);
    expect(record.state.unresolved).toBe(false);
    expect(boundary.network).toHaveBeenCalledTimes(1);
  });
  it('keeps HTTP success separate from invalid OCR output and saves the response for diagnosis', async () => {
    const input = prepared();
    const record = journal(input);
    boundary.network.mockImplementation(async () => providerResponse('{invalid-json'));
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'OUTPUT_INVALID' });
    expect(record.state.outcome).toBe('succeeded');
    expect(record.state.http).not.toBeNull();
    expect(record.state.unresolved).toBe(false);
  });
  it('fences success whose durable response transaction could not commit', async () => {
    const input = prepared();
    const record = journal(input);
    record.state.rejectSave = true;
    boundary.network.mockImplementation(async () => providerResponse(transcription(input)));
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'UNKNOWN' });
    expect(record.state).toMatchObject({ outcome: 'unknown', http: null, unresolved: true });
  });
  it('rejects response tampering or a different request on offline replay', async () => {
    const input = prepared();
    const record = journal(input);
    boundary.network.mockImplementation(async () => providerResponse(transcription(input)));
    await executeMaterialRecognitionHttp({
      ai: ai(),
      prepared: input,
      operation: record.http,
      signal: signal(),
      unresolved: record.unresolved,
    });
    const changed = structuredClone(record.state.http!);
    changed.response.bodySha256 = '0'.repeat(64);
    await expect(
      replayMaterialRecognitionHttp({ prepared: input, receipt: changed, signal: signal() })
    ).rejects.toThrow();
    const other = structuredClone(input);
    other.capability.maxOutputTokens += 1;
    await expect(
      replayMaterialRecognitionHttp({
        prepared: other,
        receipt: record.state.http!,
        signal: signal(),
      })
    ).rejects.toThrow();
    other.messages = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            mediaType: 'application/pdf',
            name: 'Unexpected original.pdf',
            data: Uint8Array.of(37, 80, 68, 70),
          },
        ],
      },
    ];
    await expect(
      replayMaterialRecognitionHttp({
        prepared: other,
        receipt: record.state.http!,
        signal: signal(),
      })
    ).rejects.toThrow('text and page images only');
    expect(boundary.network).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch when cancelled or when immutable request content changed', async () => {
    const input = prepared();
    const record = journal(input);
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: controller.signal,
        unresolved: record.unresolved,
      })
    ).rejects.toBeInstanceOf(MaterialRecognitionExecutionError);
    const changed = structuredClone(input);
    changed.system = 'different system';
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: changed,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toThrow('inputs changed');
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('rejects a provider-raised effective output token budget before admitting paid work', async () => {
    const input = prepared();
    const record = journal(input);
    boundary.raiseOutputBudget = true;
    await expect(
      executeMaterialRecognitionHttp({
        ai: ai(),
        prepared: input,
        operation: record.http,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'NOT_DISPATCHED' });
    expect(record.state.admitted).toBe(false);
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('journals one canonical local Codex invocation and replays its saved AIResponse', async () => {
    const selected = ai('codex');
    const input = prepared(selected);
    const record = journal(input);
    boundary.cli.mockResolvedValue({
      content: JSON.stringify(transcription(input)),
      model: selected.model,
      inputTokens: 10,
      outputTokens: 20,
    });
    const result = await executeMaterialRecognitionCli({
      ai: selected,
      prepared: input,
      binding: cliBinding,
      operation: record.cli,
      signal: signal(),
      unresolved: record.unresolved,
    });
    expect(record.state.outcome).toBe('succeeded');
    expect(replayMaterialRecognitionCli(input, record.state.cli!)).toEqual(result);
    expect(boundary.cli).toHaveBeenCalledTimes(1);
    expect(boundary.cli.mock.calls[0]![2].images).toHaveLength(1);
    expect(boundary.network).not.toHaveBeenCalled();
  });
  it('treats CLI errors after invocation as unknown and never repeats that invocation', async () => {
    const selected = ai('codex');
    const input = prepared(selected);
    const record = journal(input);
    boundary.cli.mockRejectedValue(new Error('CLI cleanup unconfirmed.'));
    await expect(
      executeMaterialRecognitionCli({
        ai: selected,
        prepared: input,
        binding: cliBinding,
        operation: record.cli,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toMatchObject({ outcome: 'UNKNOWN' });
    expect(record.state).toMatchObject({ outcome: 'unknown', unresolved: true });
    await expect(
      executeMaterialRecognitionCli({
        ai: selected,
        prepared: input,
        binding: cliBinding,
        operation: record.cli,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toThrow('cannot be redispatched');
    expect(boundary.cli).toHaveBeenCalledTimes(1);
  });
  it('requires persistent local account binding and rejects remote SSH before invocation', async () => {
    const selected = ai('codex');
    const input = prepared(selected);
    const record = journal(input);
    await expect(
      executeMaterialRecognitionCli({
        ai: selected,
        prepared: input,
        binding: { ...cliBinding, fingerprint: 'c'.repeat(64) },
        operation: record.cli,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toThrow('Account binding changed');
    vi.stubEnv('CODEX_SSH_HOST', 'owned-remote');
    await expect(
      executeMaterialRecognitionCli({
        ai: selected,
        prepared: input,
        binding: cliBinding,
        operation: record.cli,
        signal: signal(),
        unresolved: record.unresolved,
      })
    ).rejects.toBeInstanceOf(MaterialRecognitionUnsupported);
    expect(boundary.cli).not.toHaveBeenCalled();
  });
});

describe('canonical optional preparation response receipts', () => {
  it('preserves legacy settlement shape without enabling response storage', async () => {
    const saved: unknown[][] = [];
    const hook = learningPreparationProviderRequest(
      {
        selection: { old: true },
        admit: async () => ({ dispatch: true }),
        settle: async (...args) => {
          saved.push(args);
        },
      },
      signal(),
      () => {}
    );
    const response = await hook(
      new Request('https://owned.invalid/ai', { method: 'POST', body: '{}' }),
      async () => new Response('legacy')
    );
    expect(await response.text()).toBe('legacy');
    expect(saved[0]).toHaveLength(3);
  });
  it('enforces the opt-in response byte limit and retains an unknown dispatch outcome', async () => {
    const outcomes: string[] = [];
    let unresolved = false;
    const hook = learningPreparationProviderRequest(
      {
        selection: {},
        responseReceipt: { maxBytes: 3 },
        admit: async () => ({ dispatch: true }),
        settle: async (_database: Prisma.TransactionClient, _attempt, outcome) => {
          outcomes.push(outcome);
        },
      },
      signal(),
      () => {
        unresolved = true;
      }
    );
    await expect(
      hook(
        new Request('https://owned.invalid/ai', { method: 'POST', body: '{}' }),
        async () => new Response('oversized')
      )
    ).rejects.toThrow('unresolved outcome');
    expect(outcomes).toEqual(['unknown']);
    expect(unresolved).toBe(true);
  });
  it('validates restored HTTP receipt bytes and metadata without dispatching', async () => {
    const text = 'exact response';
    const receipt: LearningPreparationResponseReceipt = {
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'text/plain']],
      bodyBase64: Buffer.from(text).toString('base64'),
      bodySha256: sha(Buffer.from(text)),
    };
    expect(await restoreLearningPreparationResponse(receipt).text()).toBe(text);
    expect(() => restoreLearningPreparationResponse({ ...receipt, bodyBase64: '!!!!' })).toThrow();
    expect(() =>
      restoreLearningPreparationResponse({ ...receipt, bodySha256: '0'.repeat(64) })
    ).toThrow();
  });
  it('rejects an oversized serialized HTTP request before admitting or dispatching it', async () => {
    let admitted = false;
    let dispatched = false;
    const hook = learningPreparationProviderRequest(
      {
        selection: {},
        admit: async () => {
          admitted = true;
          return { dispatch: true };
        },
        settle: async () => {},
      },
      signal(),
      () => {}
    );
    await expect(
      hook(
        new Request('https://owned.invalid/ai', {
          method: 'POST',
          body: 'x'.repeat(72 * 1024 * 1024 + 1),
        }),
        async () => {
          dispatched = true;
          return new Response('unused');
        }
      )
    ).rejects.toThrow();
    expect(admitted).toBe(false);
    expect(dispatched).toBe(false);
  });
});

describe('recognition canonical identities', () => {
  it('rebuilds the exact saved input without credentials and rejects a changed capability or PNG', () => {
    const input = prepared();
    const rebuild = (selection = input.selection, images = [{ index: 0, bytes: png }]) =>
      rebuildMaterialRecognitionInput({
        source: input.source,
        capability: input.capability,
        selection,
        images,
      });
    expect(rebuild()).toEqual(input);
    expect(() => rebuild({ ...input.selection, model: 'local:changed-fixture' })).toThrow(
      'capability'
    );
    expect(() => rebuild({ ...input.selection, capabilitySha256: 'a'.repeat(64) })).toThrow(
      'capability'
    );
    expect(() =>
      rebuild({ ...input.selection, credentialRevision: '00000000-0000-4000-8000-000000000001' })
    ).toThrow();
    expect(() => rebuild(input.selection, [{ index: 0, bytes: Buffer.from('changed') }])).toThrow(
      'PNG'
    );
  });
  it('retains object meaning across database key ordering while preserving exact arrays and Unicode', () => {
    expect(materialRecognitionHash({ z: [{ b: 'é\0😀', a: true }], a: 1 })).toBe(
      materialRecognitionHash({ a: 1, z: [{ a: true, b: 'é\0😀' }] })
    );
    expect(materialRecognitionHash([1, 2])).not.toBe(materialRecognitionHash([2, 1]));
    expect(materialRecognitionHash('é')).not.toBe(materialRecognitionHash('é'));
    expect(materialRecognitionHash({ binding: { revision: 'v1' } })).not.toBe(
      materialRecognitionHash({ binding: { revision: 'v2' } })
    );
  });
  it('rejects values that cannot survive a JSON identity round trip', () => {
    for (const value of [
      undefined,
      NaN,
      Infinity,
      1n,
      new Date(),
      { missing: undefined },
      new Map(),
      new Set(),
      { nested: { value: -Infinity } },
      [undefined],
    ])
      expect(() => materialRecognitionHash(value)).toThrow('finite JSON');
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => materialRecognitionHash(cycle)).toThrow('cycles');
  });
});
