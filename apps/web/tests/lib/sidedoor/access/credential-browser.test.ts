// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCredentialSave } from 'thesidedoor-core/configuration/credential-client';
import {
  CredentialHttpError,
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
      saveCredentialSettings('ai-keys', draft(), false, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
