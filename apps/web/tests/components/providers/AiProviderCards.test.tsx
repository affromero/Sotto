import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  credentialSaveRequestSchema,
  type CredentialSaveRequest,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { AiProviderCards } from '@/components/settings/AiProviderCards';
import type { AiProviderClientMeta } from '@/lib/providers/ai-registry';

const provider: AiProviderClientMeta = {
  id: 'openai',
  displayName: 'OpenAI',
  description: 'AI provider',
  models: [],
  badge: null,
  getApiKeyUrl: '',
  authFields: [{ key: 'apiKey', label: 'API key', placeholder: 'Enter key' }],
};
function emptySettings(): CredentialSettingsSnapshot {
  return {
    context: {
      instanceId: 'instance',
      scope: 'ai-keys',
      owner: { subjectId: 'alice', generation: 1 },
    },
    heads: { openai: null },
    keys: [],
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('AI provider credential editing', () => {
  it('invalidates confirmation after an edit and confirms only the newly captured values', async () => {
    const user = userEvent.setup();
    let settings = emptySettings();
    const submitted: CredentialSaveRequest[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/settings/ai-keys');
      if (!init.method) return Response.json(settings);
      const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
      submitted.push(command);
      if (!command.allowUnverified)
        return Response.json({
          status: 'needs_confirmation',
          operationId: command.operationId,
          context: command.context,
          validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
        });
      settings = {
        ...settings,
        heads: { openai: command.operationId },
        keys: [
          {
            provider: 'openai',
            revision: command.operationId,
            isValid: true,
            verification: {
              lastAttempt: { status: 'inconclusive', checkedAt: 1 },
              lastConfirmed: null,
            },
          },
        ],
      };
      return Response.json({
        status: 'saved',
        revision: command.operationId,
        context: command.context,
        validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
      });
    });
    render(<AiProviderCards initialConfigured={[]} providerMeta={[provider]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Key' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add Key' }));
    await user.type(screen.getByLabelText('API key'), 'first-secret');
    await user.click(screen.getByRole('button', { name: 'Save Key' }));
    await screen.findByRole('button', { name: 'Save without verification' });
    await user.clear(screen.getByLabelText('API key'));
    await user.type(screen.getByLabelText('API key'), 'edited-secret');
    expect(
      screen.queryByRole('button', { name: 'Save without verification' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Key' }));
    await user.click(await screen.findByRole('button', { name: 'Save without verification' }));
    await screen.findByText('Key saved without verification.');
    expect(submitted).toHaveLength(3);
    expect(submitted[1]).toMatchObject({
      expectedRevision: null,
      values: { apiKey: 'edited-secret' },
      allowUnverified: false,
    });
    expect(submitted[1]?.operationId).not.toBe(submitted[0]?.operationId);
    expect(submitted[2]).toEqual({ ...submitted[1], allowUnverified: true });
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  });

  it('requires explicit reload after a conflict and retains the edit for review', async () => {
    const user = userEvent.setup();
    let settings = emptySettings();
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/v1/settings/ai-keys');
      if (!init.method) return Response.json(settings);
      const revision = randomUUID();
      settings = {
        ...settings,
        heads: { openai: revision },
        keys: [
          {
            provider: 'openai',
            revision,
            isValid: true,
            verification: { lastAttempt: null, lastConfirmed: null },
          },
        ],
      };
      return Response.json({}, { status: 409 });
    });
    render(<AiProviderCards initialConfigured={[]} providerMeta={[provider]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Key' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add Key' }));
    await user.type(screen.getByLabelText('API key'), 'review-this-secret');
    await user.click(screen.getByRole('button', { name: 'Save Key' }));
    const reload = await screen.findByRole('button', { name: 'Reload settings' });
    expect(screen.getByRole('button', { name: 'Save Key' })).toBeDisabled();
    await user.click(reload);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Key' })).toBeEnabled());
    expect(screen.getByLabelText('API key')).toHaveValue('review-this-secret');
  });
});
