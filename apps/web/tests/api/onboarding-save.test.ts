// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { HouseholdProfileService } from 'thesidedoor-core/access';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../helpers/setup/shared-instance';
import { POST } from '@/app/api/v1/onboarding/save/route';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { getSttProviderMeta } from '@/lib/providers/stt-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import {
  captureSottoCredentialOwner,
  sottoCredentialRows,
  sottoCredentialSlot,
} from '@/lib/sidedoor/credentials/runtime/provider-credentials';
import { onboardingSaveSchema } from '@/lib/validations';
import { getSiteConfig, setSiteConfig } from '@/lib/site-config';
import {
  defaultAutoModelConfig,
  getAutoModelConfig,
  setAutoModelConfig,
} from '@/lib/auto-model-config';
const binding = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  curriculumRead: null as (() => Promise<void>) | null,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../helpers/setup/shared-instance');
  const database = new Proxy(prismaTestBoundary(binding), {
    get(...parameters) {
      if (parameters[1] !== 'curriculum') return Reflect.get(...parameters);
      if (!binding.database) throw new Error('Test database is not initialized');
      const delegate = binding.database.curriculum;
      return {
        ...delegate,
        async findUnique(args: Parameters<typeof delegate.findUnique>[0]) {
          const result = await delegate.findUnique(args);
          await binding.curriculumRead?.();
          return result;
        },
      };
    },
  });
  return { prisma: database, prismaUnfiltered: database };
});
const base = {
  course: { native: 'en', target: 'de', level: 'B1' },
  note: 'I build distributed systems',
  preferred: { language: 'de', aiProvider: 'local', aiModel: 'local:test-model' },
};
async function request(body: unknown, token?: string) {
  if (
    token &&
    binding.database &&
    body &&
    typeof body === 'object' &&
    !Object.hasOwn(body, 'credentials')
  ) {
    type Providers = { aiProvider?: string; ttsProvider?: string; sttProvider?: string };
    const draft = body as { preferred?: Providers; infra?: Providers };
    const credentials = await sottoTransaction(binding.database, async (tx) => {
      const authority = await resolveSottoRequest(
        tx,
        new Request('http://localhost', { headers: { cookie: `sotto_session=${token}` } })
      );
      if (!authority || authority.kind !== 'content') return undefined;
      const rows = await sottoCredentialRows(tx);
      const owner = await captureSottoCredentialOwner(tx, authority.userId);
      const slots = new Map<string, ReturnType<typeof sottoCredentialSlot>>();
      for (const preferences of [draft.preferred, draft.infra]) {
        for (const [scope, provider] of [
          ['ai', preferences?.aiProvider],
          ['tts', preferences?.ttsProvider],
          ['stt', preferences?.sttProvider],
        ] as const) {
          if (!provider || ['local', 'kokoro', 'codex', 'claude-code'].includes(provider)) continue;
          const slot = sottoCredentialSlot(scope, provider);
          slots.set(`${slot.modality}:${slot.provider}`, slot);
        }
      }
      const selections = await Promise.all(
        [...slots.values()].map(async (slot) => ({
          endpoint: slot.modality === 'ai' ? 'ai-keys' : 'byok',
          provider: slot.provider,
          expectedRevision: (await rows.owned.head({ ...slot, owner })).revision,
        }))
      );
      return { context: { instanceId: rows.instance.instanceId, owner }, selections };
    });
    body = { ...body, credentials };
  }
  return new NextRequest('http://localhost:3000/api/v1/onboarding/save', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      ...(token ? { cookie: `sotto_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe('Managed onboarding save', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('returns a demo without database access', async () => {
    vi.stubEnv('SELF_HOSTED', 'false');
    const response = await POST(await request(base));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ demo: true });
  });
});
const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('Atomic onboarding with shared authority', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  beforeAll(async () => {
    instance = await createSharedTestInstance('onboarding_save');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubEnv('SIDEDOOR_PASSWORD_ORIGINS', '[]');
    vi.stubEnv('SIDEDOOR_TRUSTED_PROXY', 'false');
    identity = await instance.reset();
    await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'de' } },
      create: { nativeLang: 'en', targetLang: 'de', title: 'Test curriculum' },
      update: {},
    });
  });
  afterEach(() => {
    binding.curriculumRead = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    binding.database = null;
    if (instance) await instance.close();
  });
  function modelPreference() {
    return {
      aiProvider: 'anthropic',
      aiModel: getAiProviderMeta('anthropic').defaultModel,
      ttsProvider: 'openai',
      ttsModel: getProviderMeta('openai').defaultModel,
      sttProvider: 'openai',
      sttModel: getSttProviderMeta('openai').defaultModel,
    };
  }
  it('attaches owned staged originals and keeps them outside the editable setup note', async () => {
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: identity.ownerId,
        name: 'Vocab Deutsch.pdf',
        mimeType: 'application/pdf',
        byteSize: 18,
        originalUrl: '/api/v1/storage/materials/fixture.pdf',
        extractedText: 'Bahnhof means station.',
      },
    });
    const response = await POST(
      await request({ ...base, materialIds: [material.id] }, identity.ownerToken)
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: material.id } }))
        .courseId
    ).toBe(result.courseId);
    expect(
      (
        await instance.database.courseNote.findUniqueOrThrow({
          where: { courseId: result.courseId },
        })
      ).body
    ).toBe(base.note);
  });
  it('rejects setup claiming another learner original before committing its note', async () => {
    const other = await identity.household('Other learner');
    const material = await instance.database.courseMaterial.create({
      data: {
        userId: other.id,
        name: 'private.txt',
        mimeType: 'text/plain',
        byteSize: 4,
        originalUrl: '/api/v1/storage/materials/other.txt',
        extractedText: 'Other notes',
      },
    });
    const response = await POST(
      await request({ ...base, materialIds: [material.id] }, identity.ownerToken)
    );
    expect(response.status).toBe(409);
    expect(
      (await instance.database.courseMaterial.findUniqueOrThrow({ where: { id: material.id } }))
        .courseId
    ).toBeNull();
    expect(await instance.database.courseNote.count()).toBe(0);
  });
  it('authenticates curriculum generation with the saved local key during setup', async () => {
    const endpoint = 'http://localhost:8000/v1';
    await instance.configureInfrastructure({ aiBaseUrl: endpoint });
    await instance.seedAiCredential(identity.ownerId, 'local', 'setup-local-secret');
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent.push(request);
      if (request.headers.get('authorization') !== 'Bearer setup-local-secret')
        return Response.json({ error: { message: 'Saved key required' } }, { status: 401 });
      return Response.json({
        id: 'setup-response',
        object: 'chat.completion',
        created: 1,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                title: 'French curriculum',
                lessons: [
                  {
                    slug: 'greetings',
                    level: 'A1',
                    order: 1,
                    title: 'Greetings',
                    objective: 'Say hello',
                    grammarPoints: ['Present tense'],
                    vocabThemes: ['Greetings'],
                    targetVocab: [{ lemma: 'bonjour', gloss: 'hello' }],
                  },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });
    });
    try {
      const response = await POST(
        await request(
          {
            ...base,
            course: { native: 'en', target: 'fr', level: 'A1' },
            infra: { aiProvider: 'local', aiBaseUrl: endpoint, aiModel: 'test-model' },
          },
          identity.ownerToken
        )
      );
      expect(
        sent.map((request) => ({
          url: request.url,
          authorization: request.headers.get('authorization'),
        }))
      ).toEqual([
        {
          url: endpoint + '/chat/completions',
          authorization: 'Bearer setup-local-secret',
        },
      ]);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(
        await instance.database.course.findUnique({
          where: { id: body.courseId },
          select: { nativeLang: true, targetLang: true },
        })
      ).toEqual({ nativeLang: 'en', targetLang: 'fr' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  async function noLearnerChanges(userId = identity.ownerId) {
    expect(await instance.database.course.count()).toBe(0);
    expect(await instance.database.courseNote.count()).toBe(0);
    expect(
      (await instance.database.user.findUniqueOrThrow({ where: { id: userId } }))
        .hasCompletedOnboarding
    ).toBe(false);
  }
  function duringCurriculumRead(operation: () => Promise<void>) {
    binding.curriculumRead = operation;
  }
  it('rejects a changed displayed owner even when setup has only keyless selections', async () => {
    const first = await identity.household('First learner');
    const second = await identity.household('Second learner');
    const captured = await request(base, first.token);
    await new HouseholdProfileService(identity.access).select(first.token, second.id);
    expect((await POST(captured)).status).toBe(409);
    await noLearnerChanges(first.id);
    await noLearnerChanges(second.id);
  });

  it.each(['before admission', 'during curriculum lookup'] as const)(
    'rejects a removed personal key %s',
    async (timing) => {
      await instance.seedAiCredential(identity.ownerId, 'openai', 'original-key');
      const payload = {
        ...base,
        preferred: { aiProvider: 'openai', aiModel: getAiProviderMeta('openai').defaultModel },
      };
      const captured = await request(payload, identity.ownerToken);
      const rotate = async () =>
        sottoTransaction(instance.database, async (tx) => {
          const rows = await sottoCredentialRows(tx);
          const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
          const slot = { ...sottoCredentialSlot('ai', 'openai'), owner };
          const head = await rows.owned.head(slot);
          await rows.owned.remove(slot, head.revision, randomUUID());
        });
      if (timing === 'before admission') await rotate();
      else duringCurriculumRead(rotate);
      expect((await POST(captured)).status).toBe(409);
      await noLearnerChanges();
    }
  );

  it('rejects a disabled matching credential revision without writing onboarding state', async () => {
    await instance.seedAiCredential(identity.ownerId, 'openai', 'original-key');
    const captured = await request(
      {
        ...base,
        preferred: { aiProvider: 'openai', aiModel: getAiProviderMeta('openai').defaultModel },
      },
      identity.ownerToken
    );
    await sottoTransaction(instance.database, async (tx) => {
      const rows = await sottoCredentialRows(tx);
      const owner = await captureSottoCredentialOwner(tx, identity.ownerId);
      const slot = { ...sottoCredentialSlot('ai', 'openai'), owner };
      const head = await rows.owned.head(slot);
      const ticket = await rows.owned.beginVerification(slot, head.revision!);
      if (!ticket) throw new Error('Expected a live fixture credential');
      await rows.owned.finishVerification(ticket, {
        status: 'rejected',
        readiness: { code: 'not_authenticated', checkedAt: Date.now() },
      });
    });
    expect((await POST(captured)).status).toBe(409);
    await noLearnerChanges();
  });

  it.each(['missing envelope', 'missing slot', 'duplicate slot', 'wrong endpoint'] as const)(
    'rejects %s before completing setup',
    async (change) => {
      const captured = await request(
        {
          ...base,
          preferred: {
            aiProvider: 'anthropic',
            aiModel: getAiProviderMeta('anthropic').defaultModel,
          },
        },
        identity.ownerToken
      );
      const body = onboardingSaveSchema.parse(await captured.json());
      if (change === 'missing slot') body.credentials.selections = [];
      if (change === 'duplicate slot')
        body.credentials.selections.push(body.credentials.selections[0]!);
      if (change === 'wrong endpoint') body.credentials.selections[0]!.endpoint = 'visual-cues';
      const response = await POST(
        await request(
          change === 'missing envelope' ? { ...body, credentials: undefined } : body,
          identity.ownerToken
        )
      );
      expect(response.status).toBe(400);
      await noLearnerChanges();
    }
  );

  it.each(['aiProvider', 'ttsProvider', 'sttProvider'] as const)(
    'requires an infrastructure-only %s credential selection',
    async (field) => {
      const captured = await request(
        { ...base, infra: { [field]: 'openai' } },
        identity.ownerToken
      );
      const body = onboardingSaveSchema.parse(await captured.json());
      body.credentials.selections = [];
      expect((await POST(await request(body, identity.ownerToken))).status).toBe(400);
      await noLearnerChanges();
    }
  );

  it.each([
    { aiProvider: 'kokoro' },
    { sttProvider: 'kokoro' },
    { ttsProvider: 'codex' },
    { aiProvider: 'unknown-provider' },
  ])('rejects unsupported infrastructure providers %j', async (infra) => {
    const captured = await request(base, identity.ownerToken);
    const body = onboardingSaveSchema.parse(await captured.json());
    expect((await POST(await request({ ...body, infra }, identity.ownerToken))).status).toBe(400);
    await noLearnerChanges();
  });

  it('deduplicates a physical credential used by personal and infrastructure choices', async () => {
    const captured = await request(
      {
        ...base,
        preferred: {
          sttProvider: 'cartesia',
          sttModel: getSttProviderMeta('cartesia').defaultModel,
        },
        infra: { ttsProvider: 'cartesia' },
      },
      identity.ownerToken
    );
    const body = onboardingSaveSchema.parse(await captured.clone().json());
    expect(body.credentials.selections).toEqual([
      { endpoint: 'byok', provider: 'cartesia', expectedRevision: null },
    ]);
    expect((await POST(captured)).status).toBe(200);
  });

  it('accepts the shared speech credential slot for Cartesia transcription', async () => {
    const captured = await request(
      {
        ...base,
        preferred: {
          sttProvider: 'cartesia',
          sttModel: getSttProviderMeta('cartesia').defaultModel,
        },
      },
      identity.ownerToken
    );
    const body = onboardingSaveSchema.parse(await captured.clone().json());
    expect(body.credentials.selections).toEqual([
      { endpoint: 'byok', provider: 'cartesia', expectedRevision: null },
    ]);
    expect((await POST(captured)).status).toBe(200);
  });

  it('rejects anonymous and cross-origin writes without changing learner data', async () => {
    expect((await POST(await request(base))).status).toBe(401);
    const forged = await request(base, identity.ownerToken);
    forged.headers.set('origin', 'https://untrusted.example');
    expect((await POST(forged)).status).toBe(403);
    await noLearnerChanges();
  });
  it('saves placement, notes and preferences while preserving existing course progress on retry', async () => {
    const first = await POST(
      await request(
        { ...base, course: { ...base.course, vocabularySupport: 'MEANING_RECALL' } },
        identity.ownerToken
      )
    );
    expect(first.status).toBe(200);
    const { courseId } = await first.json();
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({
      userId: identity.ownerId,
      currentLevel: 'B1',
      startLevel: 'B1',
      placementSource: 'MANUAL',
      vocabularySupport: 'MEANING_RECALL',
    });
    expect(
      await instance.database.courseNote.findUniqueOrThrow({ where: { courseId } })
    ).toMatchObject({ body: base.note });
    expect(
      await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } })
    ).toMatchObject({
      hasCompletedOnboarding: true,
      preferredLanguage: 'de',
      preferredAiModel: 'local:test-model',
    });
    expect(
      await instance.database.learningLevelBinding.findUniqueOrThrow({
        where: { courseId_level: { courseId, level: 'B1' } },
      })
    ).toMatchObject({ coverage: { level: 'B1', scope: 'CLASS' } });
    expect(await instance.database.learningObservation.count()).toBe(0);
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
    await instance.database.course.update({
      where: { id: courseId },
      data: { currentLevel: 'C1' },
    });
    const retry = await POST(
      await request(
        { ...base, course: { ...base.course, level: 'A1' }, note: '' },
        identity.ownerToken
      )
    );
    expect(retry.status).toBe(200);
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ currentLevel: 'C1', startLevel: 'B1', vocabularySupport: 'MEANING_RECALL' });
    expect(
      await instance.database.courseNote.findUniqueOrThrow({ where: { courseId } })
    ).toMatchObject({ body: base.note });
    expect(await instance.database.course.count()).toBe(1);
    const cleared = await POST(
      await request(
        { ...base, course: { ...base.course, vocabularySupport: null } },
        identity.ownerToken
      )
    );
    expect(cleared.status).toBe(200);
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ currentLevel: 'C1', vocabularySupport: null });
  });
  it('captures initial requirements after the setup speech preferences and endpoints are saved', async () => {
    const response = await POST(
      await request(
        {
          ...base,
          preferred: {
            ...base.preferred,
            ttsProvider: 'local',
            ttsModel: 'local:synthetic-speech',
          },
          infra: {
            ttsProvider: 'local',
            ttsBaseUrl: 'http://localhost:8001/tts',
            sttProvider: 'local',
            sttBaseUrl: 'http://localhost:8002/stt',
          },
        },
        identity.ownerToken
      )
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    const binding = await instance.database.learningLevelBinding.findUniqueOrThrow({
      where: {
        courseId_level: { courseId: result.courseId, level: 'B1' },
      },
    });
    expect(binding.coverage).toMatchObject({
      skills: { LISTENING: { state: 'REQUIRED' }, SPEAKING: { state: 'REQUIRED' } },
    });
    expect(await instance.database.learningLevelCompletion.count()).toBe(0);
  });
  it('rejects household server configuration before creating a course', async () => {
    const initialConfiguration = await getSiteConfig();
    const household = await identity.household('Learner');
    expect(
      (await POST(await request({ ...base, infra: { ttsProvider: 'kokoro' } }, household.token)))
        .status
    ).toBe(403);
    await noLearnerChanges(household.id);
    expect(await getSiteConfig()).toEqual(initialConfiguration);
  });
  it('commits owner model choices ahead of conflicting legacy infrastructure', async () => {
    const preferred = modelPreference();
    const response = await POST(
      await request({ ...base, preferred, infra: { ttsProvider: 'kokoro' } }, identity.ownerToken)
    );
    expect(response.status).toBe(200);
    expect(await getSiteConfig()).toMatchObject({ ttsProvider: preferred.ttsProvider });
    expect(await getAutoModelConfig()).toMatchObject({ model: preferred });
  });
  it.each(['cloud', 'compatible'])(
    'builds a new curriculum with the pending %s selection before committing learner preferences',
    async (connection) => {
      const compatible = connection === 'compatible';
      const provider = compatible ? 'local' : 'groq';
      const native = compatible ? 'it' : 'es';
      const model = compatible ? 'local:curriculum-tutor' : getAiProviderMeta('groq').defaultModel;
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: { preferredAiProvider: 'codex', preferredAiModel: 'codex' },
      });
      if (!compatible) await instance.seedAiCredential(identity.ownerId, 'groq', 'curriculum-key');
      const calls: Request[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const outgoing = new Request(input, init);
        calls.push(outgoing);
        if (outgoing.url.endsWith('/moderations'))
          return Response.json({ results: [{ flagged: false }] });
        expect(
          (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } }))
            .preferredAiProvider
        ).toBe('codex');
        const content = JSON.stringify({
          title: 'French conversation',
          lessons: [
            {
              slug: 'first-greeting',
              level: 'A1',
              order: 1,
              title: 'A first meeting',
              objective: 'Introduce yourself',
              grammarPoints: ['Subject pronouns'],
              vocabThemes: ['Greetings'],
              targetVocab: [{ lemma: 'bonjour', gloss: 'hello' }],
            },
          ],
        });
        return Response.json({
          id: 'curriculum-fixture',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        });
      });
      const result = await POST(
        await request(
          {
            course: { native, target: 'fr', level: 'A1' },
            preferred: { aiProvider: provider, aiModel: model },
            ...(compatible
              ? {
                  infra: {
                    aiProvider: 'local',
                    aiBaseUrl: 'http://localhost:18192/v1',
                    aiModel: 'curriculum-tutor',
                  },
                }
              : {}),
          },
          identity.ownerToken
        )
      );
      expect(result.status).toBe(200);
      const generation = calls.find((call) => call.url.endsWith('/chat/completions'))!;
      expect(generation.url).toBe(
        compatible
          ? 'http://localhost:18192/v1/chat/completions'
          : 'https://api.groq.com/openai/v1/chat/completions'
      );
      expect(generation.headers.get('authorization')).toBe(
        compatible ? 'Bearer local' : 'Bearer curriculum-key'
      );
      expect(await generation.json()).toMatchObject({
        model: compatible ? 'curriculum-tutor' : model,
      });
      const created = await instance.database.course.findUniqueOrThrow({
        where: {
          userId_nativeLang_targetLang: {
            userId: identity.ownerId,
            nativeLang: native,
            targetLang: 'fr',
          },
        },
        include: { curriculum: { include: { lessons: true } } },
      });
      expect(created.curriculum.lessons).toMatchObject([{ slug: 'first-greeting' }]);
      expect(
        (await instance.database.user.findUniqueOrThrow({ where: { id: identity.ownerId } }))
          .preferredAiProvider
      ).toBe(provider);
    }
  );
  it('does not complete a save after the issuing session signs out during curriculum lookup', async () => {
    duringCurriculumRead(() => identity.access.logout(identity.ownerToken));
    expect((await POST(await request(base, identity.ownerToken))).status).toBe(401);
    await noLearnerChanges();
  });
  it('rejects an owner demotion during curriculum lookup without saving infrastructure', async () => {
    const initialConfiguration = await getSiteConfig();
    duringCurriculumRead(() =>
      identity.access.store.transact((state) => {
        const owner = state.principals.find((principal) => principal.id === identity.ownerId);
        if (!owner) throw new Error('Admin profile missing');
        owner.role = 'member';
      })
    );
    expect(
      (
        await POST(
          await request(
            {
              ...base,
              infra: { ttsProvider: 'kokoro' },
            },
            identity.ownerToken
          )
        )
      ).status
    ).toBe(403);
    await noLearnerChanges();
    expect(await getSiteConfig()).toEqual(initialConfiguration);
  });
  it('rejects a stale infrastructure update after another owner save', async () => {
    duringCurriculumRead(async () => {
      await setSiteConfig({ ttsProvider: 'openai' }, identity.ownerId);
    });
    expect(
      (
        await POST(
          await request({ ...base, infra: { ttsProvider: 'kokoro' } }, identity.ownerToken)
        )
      ).status
    ).toBe(409);
    await noLearnerChanges();
    expect(await getSiteConfig()).toMatchObject({ ttsProvider: 'openai' });
  });
  it('rejects newer learner preferences instead of overwriting them after curriculum lookup', async () => {
    duringCurriculumRead(async () => {
      await instance.database.user.update({
        where: { id: identity.ownerId },
        data: { preferredLanguage: 'fr' },
      });
    });
    expect((await POST(await request(base, identity.ownerToken))).status).toBe(409);
    await noLearnerChanges();
    expect(
      (
        await instance.database.user.findUniqueOrThrow({
          where: { id: identity.ownerId },
        })
      ).preferredLanguage
    ).toBe('fr');
  });
  it('preserves a newer server model selection while onboarding is in flight', async () => {
    const newerModel = getAiProviderMeta('openai').defaultModel;
    duringCurriculumRead(async () => {
      await setAutoModelConfig(
        { model: { aiProvider: 'openai', aiModel: newerModel } },
        identity.ownerId
      );
    });
    const response = await POST(
      await request(
        {
          ...base,
          preferred: modelPreference(),
        },
        identity.ownerToken
      )
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Reload setup');
    await noLearnerChanges();
    expect(await getAutoModelConfig()).toMatchObject({
      model: { aiProvider: 'openai', aiModel: newerModel },
    });
  });
  it('preserves notes edited while another setup request is in flight', async () => {
    const first = await POST(await request(base, identity.ownerToken));
    const { courseId } = await first.json();
    duringCurriculumRead(async () => {
      await instance.database.courseNote.update({
        where: { courseId },
        data: { body: 'My newer learning goals' },
      });
    });
    expect((await POST(await request(base, identity.ownerToken))).status).toBe(409);
    expect(
      (
        await instance.database.courseNote.findUniqueOrThrow({
          where: { courseId },
        })
      ).body
    ).toBe('My newer learning goals');
  });
  it('rejects a household selection change during curriculum lookup', async () => {
    const first = await identity.household('First learner');
    const second = await identity.household('Second learner');
    duringCurriculumRead(() =>
      new HouseholdProfileService(identity.access).select(first.token, second.id)
    );
    expect((await POST(await request(base, first.token))).status).toBe(409);
    await noLearnerChanges(first.id);
    expect(
      (
        await instance.database.user.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).hasCompletedOnboarding
    ).toBe(false);
  });
  it('rolls back learner and infrastructure writes when model persistence fails', async () => {
    const initialConfiguration = await getSiteConfig();
    await instance.database.$executeRawUnsafe(
      `ALTER TABLE "SidedoorState" ADD CONSTRAINT "test_model_failure" CHECK (id <> 'sotto-platform-v2' OR state #>> '{configuration,automaticModels,model,aiProvider}' <> 'anthropic') NOT VALID`
    );
    try {
      const response = await POST(
        await request(
          { ...base, preferred: modelPreference(), infra: { ttsProvider: 'kokoro' } },
          identity.ownerToken
        )
      );
      expect(response.status).toBe(503);
      await noLearnerChanges();
      expect(await getSiteConfig()).toEqual(initialConfiguration);
      expect(await getAutoModelConfig()).toEqual(defaultAutoModelConfig());
    } finally {
      await instance.database.$executeRawUnsafe(
        'ALTER TABLE "SidedoorState" DROP CONSTRAINT "test_model_failure"'
      );
    }
  });
  it('rejects identical languages without saving', async () => {
    expect(
      (
        await POST(
          await request({ ...base, course: { native: 'en', target: 'en' } }, identity.ownerToken)
        )
      ).status
    ).toBe(400);
    await noLearnerChanges();
  });
  it('rejects an explicit mismatched provider and model before saving', async () => {
    const response = await POST(
      await request(
        {
          ...base,
          preferred: { aiProvider: 'anthropic', aiModel: getAiProviderMeta('openai').defaultModel },
        },
        identity.ownerToken
      )
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('does not belong');
    await noLearnerChanges();
    expect(await getAutoModelConfig()).toEqual(defaultAutoModelConfig());
  });
});
