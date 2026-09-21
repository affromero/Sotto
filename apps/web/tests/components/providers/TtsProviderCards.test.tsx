import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  credentialSaveRequestSchema,
  type CredentialSaveRequest,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { TtsProviderCards } from '@/components/settings/TtsProviderCards';
import { CARTESIA_USAGE_ALLOWANCE } from '@/lib/provider-usage/allowances';
import type { TtsProviderClientMeta } from '@/lib/providers/tts-registry';

const provider: TtsProviderClientMeta = {
  id: 'cartesia',
  displayName: 'Cartesia',
  getApiKeyUrl: '',
  qualityTier: 'premium',
  supportsSfx: false,
  supportsStreaming: true,
  models: [],
  recommended: true,
  languageDetection: 'auto',
  voicesAreCrossLingual: true,
  authFields: [{ key: 'apiKey', label: 'API key', placeholder: 'Key' }],
  usageAllowance: CARTESIA_USAGE_ALLOWANCE,
};
afterEach(() => vi.unstubAllGlobals());

it('preserves the stored key when changing a plan and sends typed settings with explicit custom-limit removal', async () => {
  const user = userEvent.setup();
  const revision = randomUUID();
  let settings: CredentialSettingsSnapshot = {
    context: {
      instanceId: 'instance',
      scope: 'byok',
      owner: { subjectId: 'alice', generation: 1 },
    },
    heads: { cartesia: revision },
    keys: [
      {
        provider: 'cartesia',
        revision,
        isValid: true,
        verification: { lastAttempt: null, lastConfirmed: null },
      },
    ],
  };
  let submitted: CredentialSaveRequest | undefined;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/v1/settings/byok');
    if (!init.method) return Response.json(settings);
    submitted = credentialSaveRequestSchema.parse(JSON.parse(String(init.body)));
    settings = {
      ...settings,
      heads: { cartesia: submitted.operationId },
      keys: [
        {
          provider: 'cartesia',
          revision: submitted.operationId,
          isValid: true,
          verification: {
            lastAttempt: { status: 'verified', checkedAt: 1 },
            lastConfirmed: { status: 'verified', checkedAt: 1 },
          },
        },
      ],
    };
    return Response.json({
      status: 'saved',
      revision: submitted.operationId,
      context: submitted.context,
      validation: { status: 'valid', readiness: { code: 'ready', checkedAt: 1 } },
    });
  });
  render(
    <TtsProviderCards
      initialConfigured={[{ provider: 'cartesia', isValid: true }]}
      providerMeta={[provider]}
    />
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Replace Key' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Replace Key' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Usage plan' }), 'pro');
  await user.type(screen.getByLabelText('Billing reset day'), '15');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Key saved and verified.');
  expect(submitted).toMatchObject({
    expectedRevision: revision,
    patch: { usagePlan: 'pro', monthlyCreditLimit: null, billingResetDay: 15 },
  });
  expect(submitted).not.toHaveProperty('values');
  expect(submitted && 'patch' in submitted ? submitted.patch : {}).not.toHaveProperty('apiKey');
});
