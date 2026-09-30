import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  credentialSaveRequestSchema,
  type CredentialSaveRequest,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { LocalAiSettings } from '@/components/settings/LocalAiSettings';

function emptySettings(): CredentialSettingsSnapshot {
  return {
    context: {
      instanceId: 'instance',
      scope: 'ai-keys',
      owner: { subjectId: 'alice', generation: 1 },
    },
    heads: { local: null },
    keys: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('local AI settings', () => {
  it('saves a compatible endpoint and model, then an optional encrypted key', async () => {
    const user = userEvent.setup();
    let settings = emptySettings();
    const serverSettings: unknown[] = [];
    const submittedKeys: CredentialSaveRequest[] = [];

    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      if (url === '/api/v1/admin/site-config') {
        if (init.method === 'PATCH') serverSettings.push(JSON.parse(String(init.body)));
        return Response.json({});
      }
      expect(url).toBe('/api/v1/settings/ai-keys');
      if (!init.method) return Response.json(settings);

      const command = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
      submittedKeys.push(command);
      if (!command.allowUnverified)
        return Response.json({
          status: 'needs_confirmation',
          operationId: command.operationId,
          context: command.context,
          validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 1 } },
        });

      settings = {
        ...settings,
        heads: { local: command.operationId },
        keys: [
          {
            provider: 'local',
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

    render(<LocalAiSettings initialBaseUrl="http://localhost:11434/v1" initialModel="qwen3" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add API key' })).toBeEnabled());

    await user.clear(screen.getByLabelText('Endpoint URL'));
    await user.type(screen.getByLabelText('Endpoint URL'), 'http://localhost:8000/v1');
    await user.clear(screen.getByLabelText('Model ID'));
    await user.type(screen.getByLabelText('Model ID'), 'custom-model');
    await user.click(screen.getByRole('button', { name: 'Save server settings' }));
    await screen.findByText('AI server settings saved.');
    expect(serverSettings).toEqual([
      {
        aiProvider: 'local',
        aiBaseUrl: 'http://localhost:8000/v1',
        aiModel: 'custom-model',
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Add API key' }));
    await user.type(screen.getByLabelText('New API key'), 'local-secret');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));
    await user.click(await screen.findByRole('button', { name: 'Save without verification' }));
    await screen.findByText('Key saved without verification.');

    expect(submittedKeys).toHaveLength(2);
    expect(submittedKeys[0]).toMatchObject({ provider: 'local', values: { apiKey: 'local-secret' } });
    expect(submittedKeys[1]).toEqual({ ...submittedKeys[0], allowUnverified: true });
    expect(screen.queryByLabelText('New API key')).not.toBeInTheDocument();
  });
});
