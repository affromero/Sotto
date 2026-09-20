// @vitest-environment node
import { NextRequest } from 'next/server';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import { POST } from '@/app/api/v1/episodes/[episodeId]/interact/[interactionId]/incorporate/route';
import { getAiProviderMeta } from '@/lib/providers/ai-registry';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { sottoDeviceService } from '@/lib/sidedoor/access/state/device-identity';
import {
  createSharedTestInstance,
  type SharedTestInstance,
  type SharedTestIdentity,
} from '../../helpers/setup/shared-instance';

const binding = vi.hoisted(() => ({
  database: null as PrismaClient | null,
  duringGeneration: null as (() => Promise<void>) | null,
  fail: false,
  calls: [] as Array<{ apiKey: string; model: string }>,
}));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(binding);
  return { prisma: database, prismaUnfiltered: database };
});

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('incorporation HTTP with canonical access and durable jobs', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    instance = await createSharedTestInstance('incorporation_http');
    binding.database = instance.database;
  });
  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('BYOK_ENCRYPTION_KEY', '1'.repeat(64));
    identity = await instance.reset();
    binding.calls = [];
    binding.duringGeneration = null;
    binding.fail = false;
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const anthropic = String(url) === 'https://api.anthropic.com/v1/messages';
      if (!anthropic && String(url) !== 'https://api.openai.com/v1/chat/completions')
        throw new Error('Unexpected external request');
      const headers = new Headers(init?.headers);
      const { model } = JSON.parse(String(init?.body)) as { model: string };
      const apiKey = anthropic
        ? headers.get('x-api-key')
        : headers.get('authorization')?.replace(/^Bearer /, '');
      binding.calls.push({ apiKey: apiKey ?? '', model });
      await binding.duringGeneration?.();
      if (binding.fail)
        return Response.json(
          { error: { type: 'invalid_request_error', message: 'Provider rejected the request' } },
          { status: 400 }
        );
      if (!anthropic)
        return Response.json({
          id: 'completion',
          object: 'chat.completion',
          created: 0,
          model,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'OpenAI explanation.' },
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 3 },
        });
      return Response.json({
        id: 'message',
        type: 'message',
        role: 'assistant',
        model,
        stop_reason: 'end_turn',
        stop_sequence: null,
        content: [{ type: 'text', text: 'Generated explanation.' }],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      });
    });
  });
  afterAll(async () => {
    await instance?.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  async function fixture(model: string | null = null, withKey = true) {
    if (withKey)
      await instance.seedAiCredential(identity.ownerId, 'anthropic', 'test-anthropic-key');
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Lesson',
        topic: 'Spanish',
        status: 'READY',
        aiModel: model,
        ttsProvider: 'local',
        ttsModel: 'custom-local-model',
        segments: {
          create: { order: 0, speaker: 'HOST', text: 'Context.', startTime: 0, duration: 20 },
        },
      },
    });
    const interaction = await instance.database.interaction.create({
      data: {
        userId: identity.ownerId,
        episodeId: episode.id,
        status: 'ANSWERED',
        question: 'Why?',
        answer: 'Because.',
        timestamp: 5,
      },
    });
    const invoke = (token = identity.ownerToken, requestOrigin = origin) =>
      POST(
        new NextRequest(
          `${origin}/api/v1/episodes/${episode.id}/interact/${interaction.id}/incorporate`,
          { method: 'POST', headers: { cookie: `sotto_session=${token}`, origin: requestOrigin } }
        ),
        { params: Promise.resolve({ episodeId: episode.id, interactionId: interaction.id }) }
      );
    return { episode, interaction, invoke };
  }
  async function unchanged(item: Awaited<ReturnType<typeof fixture>>) {
    expect(
      await instance.database.episode.findUniqueOrThrow({ where: { id: item.episode.id } })
    ).toMatchObject({ status: 'READY' });
    expect(
      await instance.database.interaction.findUniqueOrThrow({ where: { id: item.interaction.id } })
    ).toMatchObject({ status: 'ANSWERED' });
    expect(
      (await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).listIncomplete())).jobs
    ).toEqual([]);
  }
  it.each([null, 'explicit'])(
    'preserves configured BYOK generation with model=%s',
    async (selection) => {
      const model = getAiProviderMeta('anthropic').defaultModel;
      const item = await fixture(selection ? model : null);
      const response = await item.invoke();
      expect(response.status).toBe(202);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body = await response.json();
      expect(body).toMatchObject({
        status: 'incorporating',
        generatedText: 'Generated explanation.',
        interactionId: item.interaction.id,
        insertAfterOrder: 0,
      });
      expect(binding.calls).toEqual([{ apiKey: 'test-anthropic-key', model }]);
      expect(
        await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).read(body.operationId))
      ).toMatchObject({ complete: false, job: { payload: { newText: 'Generated explanation.' } } });
      await vi.waitFor(async () =>
        expect(
          await instance.database.apiUsageLog.count({
            where: { episodeId: item.episode.id, category: 'incorporation' },
          })
        ).toBe(1)
      );
    }
  );
  it('uses the explicitly selected provider key when multiple BYOK providers are configured', async () => {
    const model = getAiProviderMeta('openai').defaultModel;
    const item = await fixture(model);
    await instance.seedAiCredential(identity.ownerId, 'openai', 'test-openai-key');
    const response = await item.invoke();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ generatedText: 'OpenAI explanation.' });
    expect(binding.calls).toEqual([{ apiKey: 'test-openai-key', model }]);
    await vi.waitFor(async () =>
      expect(
        await instance.database.apiUsageLog.count({
          where: { episodeId: item.episode.id, category: 'incorporation', service: 'openai' },
        })
      ).toBe(1)
    );
  });
  it('runs the selected local CLI without requiring a hosted API key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sotto-incorporation-cli-'));
    const originalPath = process.env.PATH!;
    const invocationPath = join(directory, 'invocation.json');
    const model = getAiProviderMeta('claude-code').defaultModel;
    try {
      await writeFile(
        join(directory, 'claude'),
        `#!${process.execPath}\nconst fs = require('node:fs');\nlet input = '';\nprocess.stdin.on('data', chunk => input += chunk);\nprocess.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({args: process.argv.slice(2), input})); console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Local CLI explanation.'}]}})); console.log(JSON.stringify({type:'result',subtype:'success',usage:{input_tokens:14,output_tokens:6,cache_read_input_tokens:0,cache_creation_input_tokens:0}})); });\n`,
        { mode: 0o700 }
      );
      vi.stubEnv('PATH', `${directory}:${originalPath}`);
      vi.stubEnv('CLAUDE_HOME', directory);
      vi.stubEnv('CLAUDE_CODE_CREDENTIALS_JSON', '');
      vi.stubEnv('CLAUDE_CODE_SSH_HOST', '');
      const item = await fixture(model, false);
      const response = await item.invoke();
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ generatedText: 'Local CLI explanation.' });
      const invocation = JSON.parse(await readFile(invocationPath, 'utf8'));
      expect(invocation.input).toContain('Why?');
      expect(invocation.args).toContain('--model');
      expect(invocation.args).toContain('stream-json');
      expect(binding.calls).toEqual([]);
      await vi.waitFor(async () =>
        expect(
          await instance.database.apiUsageLog.count({
            where: {
              episodeId: item.episode.id,
              category: 'incorporation',
              service: 'claude-code',
            },
          })
        ).toBe(1)
      );
    } finally {
      vi.stubEnv('PATH', originalPath);
      vi.stubEnv('CLAUDE_HOME', '');
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([null, 'explicit'])(
    'rejects missing credentials with model=%s without changing source status',
    async (selection) => {
      const item = await fixture(
        selection ? getAiProviderMeta('anthropic').defaultModel : null,
        false
      );
      expect((await item.invoke()).status).toBe(403);
      expect(binding.calls).toEqual([]);
      await unchanged(item);
    }
  );
  it('leaves both source statuses unchanged when the provider rejects generation', async () => {
    const item = await fixture();
    binding.fail = true;
    const response = await item.invoke();
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('AI generation failed');
    await unchanged(item);
  });
  it('rejects revocation during AI generation and records incurred usage', async () => {
    const item = await fixture();
    binding.duringGeneration = () => identity.access.logout(identity.ownerToken);
    const response = await item.invoke();
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('Generated explanation');
    await unchanged(item);
    await vi.waitFor(async () =>
      expect(
        await instance.database.apiUsageLog.count({
          where: { episodeId: item.episode.id, category: 'incorporation' },
        })
      ).toBe(1)
    );
  });
  it('rejects cross-origin browser requests before AI', async () => {
    const item = await fixture();
    expect((await item.invoke(identity.ownerToken, 'https://untrusted.example')).status).toBe(403);
    expect(binding.calls).toEqual([]);
    await unchanged(item);
  });
  it.each([true, false])(
    'validates native bearer credentials without browser Origin (valid=%s)',
    async (valid) => {
      const item = await fixture();
      const devices = sottoDeviceService(identity.access);
      const token = valid
        ? await devices.redeemPairing(
            await devices.issuePairing(identity.ownerToken, ['app'], 'Phone')
          )
        : 'invalid-token';
      const response = await POST(
        new NextRequest(
          `${origin}/api/v1/episodes/${item.episode.id}/interact/${item.interaction.id}/incorporate`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              cookie: `sotto_session=${identity.ownerToken}`,
            },
          }
        ),
        {
          params: Promise.resolve({
            episodeId: item.episode.id,
            interactionId: item.interaction.id,
          }),
        }
      );
      expect(response.status).toBe(valid ? 202 : 401);
      if (!valid) {
        expect(binding.calls).toEqual([]);
        await unchanged(item);
        return;
      }
      await vi.waitFor(async () =>
        expect(
          await instance.database.apiUsageLog.count({
            where: { episodeId: item.episode.id, category: 'incorporation' },
          })
        ).toBe(1)
      );
    }
  );
});
