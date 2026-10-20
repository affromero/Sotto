// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCredentialSave } from 'thesidedoor-core/configuration/credential-client';
import { CredentialDraftDigest } from '@/lib/sidedoor/credentials/config/credential-digest';
import {
  CredentialHttpError,
  captureCredentialReceipt,
  saveCredentialSettings,
} from '@/lib/sidedoor/credentials/config/credential-browser';

const displayed = {
  context: {
    instanceId: 'test-instance',
    scope: 'ai-keys',
    owner: { subjectId: 'alice', generation: 1 },
  },
  heads: { openai: null },
  keys: [],
};
const draft = () =>
  prepareCredentialSave(displayed, 'openai', { values: { apiKey: 'private-test-key' } });
afterEach(() => vi.unstubAllGlobals());

describe('credential browser transport', () => {
  it('compares draft values only within the session that captured them', () => {
    const session = new CredentialDraftDigest();
    const draft = ['local', 'https://models.example/v1', 'test-secret'];
    const captured = session.digest(draft);
    expect(session.digest([...draft])).toBe(captured);
    expect(session.digest([...draft, 'changed'])).not.toBe(captured);
    expect(new CredentialDraftDigest().digest(draft)).not.toBe(captured);
    expect(captured).not.toContain('test-secret');
  });
  it('projects an immutable receipt without submitted credential values', () => {
    const command = draft();
    const captured = captureCredentialReceipt(command);
    expect(captured).toEqual({
      context: command.context,
      provider: command.provider,
      expectedRevision: command.expectedRevision,
      operationId: command.operationId,
    });
    expect(JSON.stringify(captured)).not.toContain('private-test-key');
    expect(() => {
      captured.context.owner.subjectId = 'another-owner';
    }).toThrow();
    expect(command.context.owner.subjectId).toBe('alice');
  });
  it('reconciles a lost save response without sending a second mutation', async () => {
    const command = draft();
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(init.method ?? 'GET');
      if (init.method === 'POST') throw new TypeError('Connection closed after commit');
      return Response.json({
        ...displayed,
        heads: { openai: command.operationId },
        keys: [
          {
            provider: 'openai',
            revision: command.operationId,
            isValid: false,
            verification: {
              lastAttempt: { status: 'rejected', checkedAt: 10 },
              lastConfirmed: { status: 'rejected', checkedAt: 10 },
            },
          },
        ],
      });
    });
    expect(await saveCredentialSettings('ai-keys', command)).toMatchObject({
      status: 'confirmed',
      key: { isValid: false },
    });
    expect(requests).toEqual(['POST', 'GET']);
  });
  it('keeps confirmation tied to the submitted operation', async () => {
    const command = draft();
    vi.stubGlobal('fetch', async () =>
      Response.json({
        status: 'needs_confirmation',
        operationId: command.operationId,
        context: command.context,
        validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
      })
    );
    expect(await saveCredentialSettings('ai-keys', command)).toEqual({
      status: 'needs_confirmation',
    });
  });
  it.each(['local', 'openai'])(
    'limits endpoint-review metadata to the compatible slot rather than %s credentials generally',
    async (provider) => {
      const submitted = prepareCredentialSave(
        { ...displayed, heads: { [provider]: null } },
        provider,
        { values: { apiKey: 'endpoint-review-fixture' } }
      );
      const exchanges: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
      vi.stubGlobal('fetch', async (_input: RequestInfo | URL, options: RequestInit) => {
        exchanges.push({
          headers: new Headers(options.headers),
          body: JSON.parse(String(options.body)),
        });
        return Response.json({
          status: 'needs_confirmation',
          context: submitted.context,
          operationId: submitted.operationId,
          validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 4 } },
        });
      });
      const reviewedEndpoint = 'https://reviewed.example/deployment/v1';
      for (const allowUnverified of [false, true]) {
        expect(
          await saveCredentialSettings('ai-keys', submitted, { reviewedEndpoint, allowUnverified })
        ).toMatchObject({ status: 'needs_confirmation' });
      }
      expect(
        exchanges.map((exchange) => exchange.headers.get('x-sotto-reviewed-ai-endpoint'))
      ).toEqual(provider === 'local' ? [reviewedEndpoint, reviewedEndpoint] : [null, null]);
      expect(exchanges[0].body.allowUnverified).toBe(false);
      expect(exchanges[1].body).toEqual({ ...exchanges[0].body, allowUnverified: true });
    }
  );
  it('distinguishes a saved receipt from an unknown outcome when the follow-up read fails', async () => {
    const command = draft();
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (!init.method) throw new TypeError('Offline');
      return Response.json({
        status: 'saved',
        revision: command.operationId,
        context: command.context,
        validation: { status: 'valid', readiness: { code: 'ready', checkedAt: 1 } },
      });
    });
    expect(await saveCredentialSettings('ai-keys', command)).toEqual({
      status: 'acknowledged',
      operation: 'save',
    });
  });
  it('does not reconcile a definitive conflict or claim that a mismatched receipt succeeded', async () => {
    const command = draft();
    vi.stubGlobal('fetch', async () => Response.json({}, { status: 409 }));
    await expect(saveCredentialSettings('ai-keys', command)).rejects.toBeInstanceOf(
      CredentialHttpError
    );
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) =>
      init.method
        ? Response.json({
            status: 'saved',
            revision: randomUUID(),
            context: command.context,
            validation: { status: 'valid', readiness: { code: 'ready', checkedAt: 1 } },
          })
        : Response.json(displayed)
    );
    expect(await saveCredentialSettings('ai-keys', command)).toEqual({ status: 'unknown' });
  });
  it('suppresses a late mutation response after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => {
      controller.abort();
      return Response.json(displayed);
    });
    await expect(
      saveCredentialSettings('ai-keys', draft(), { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
