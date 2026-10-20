import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { credentialSaveRequestSchema } from 'thesidedoor-core/configuration/credential-client';
import { WelcomeFlow } from '@/app/welcome/WelcomeFlow';
import { createWelcomeCredentialBoundary } from '../../helpers/setup/welcome-credentials';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function wizard(card: 'local' | 'custom' | 'claude', owner = true) {
  const boundary = createWelcomeCredentialBoundary();
  const writes: Array<{ url: string; options: RequestInit }> = [];
  const config = { selfHosted: true, isOwner: owner, onboardingResumeKey: 'connection-check' };
  let configure: () => Promise<Response> = async () => Response.json({});
  let confirmation = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const url = String(input);
    if (options.method) writes.push({ url, options });
    if (url.endsWith('/site-config')) return configure();
    if (confirmation && options.method === 'POST') {
      const draft = credentialSaveRequestSchema.parse(JSON.parse(String(options.body)));
      if (!draft.allowUnverified)
        return Response.json({
          status: 'needs_confirmation',
          operationId: draft.operationId,
          context: draft.context,
          validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 2 } },
        });
    }
    return boundary.handle(input, options) ?? Response.json(config);
  });
  window.localStorage.setItem(
    'sotto.onboarding.v1',
    JSON.stringify({
      onboardingResumeKey: config.onboardingResumeKey,
      step: 4,
      language: 'fr',
      agent: {
        provider: card,
        method: card === 'claude' ? 'key' : 'url',
        value: card === 'claude' ? '' : 'https://classroom.example/v1',
        model: 'classroom-model',
      },
    })
  );
  render(<WelcomeFlow initialConfig={config} />);
  return {
    writes,
    boundary,
    user: userEvent.setup(),
    configure(response: () => Promise<Response>) {
      configure = response;
    },
    requireConfirmation() {
      confirmation = true;
    },
  };
}

describe('wizard connection save boundaries', () => {
  it.each(['local', 'custom'] as const)(
    'waits for the %s address to commit before dispatching authentication',
    async (card) => {
      const setup = wizard(card);
      const configuration = Promise.withResolvers<Response>();
      setup.configure(() => configuration.promise);
      const key = await screen.findByLabelText(`${card === 'local' ? 'Local' : 'Custom'} API key`);
      await waitFor(() => expect(key).toBeEnabled());
      await setup.user.type(key, 'connection-specific-key');
      await setup.user.click(screen.getByRole('button', { name: 'Save configuration' }));
      expect(setup.boundary.saved.size).toBe(0);
      expect(screen.getByRole('button', { name: /^Continue/ })).toBeDisabled();
      expect(screen.queryByText('Endpoint configured')).not.toBeInTheDocument();
      await act(async () => configuration.resolve(Response.json({})));
      await screen.findByText('Endpoint configured');
      expect(setup.writes.map(({ url }) => url)).toEqual([
        '/api/v1/admin/site-config',
        '/api/v1/settings/ai-keys',
      ]);
      expect(JSON.parse(String(setup.writes[0].options.body))).toEqual({
        aiProvider: 'local',
        aiModel: 'classroom-model',
        aiBaseUrl: 'https://classroom.example/v1',
      });
      expect(new Headers(setup.writes[1].options.headers).get('x-sotto-reviewed-ai-endpoint')).toBe(
        'https://classroom.example/v1'
      );
      expect(setup.boundary.saved.get('ai-keys:local')).toEqual({
        apiKey: 'connection-specific-key',
      });
      expect(window.localStorage.getItem('sotto.onboarding.v1')).not.toContain(
        'connection-specific-key'
      );
      await setup.user.type(screen.getByLabelText('Endpoint URL'), '/next');
      expect(screen.queryByText('Endpoint configured')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Continue/ })).toBeDisabled();
    }
  );

  it('keeps an owner configuration failure from becoming saved connection proof', async () => {
    const setup = wizard('custom');
    setup.configure(async () => Response.json({}, { status: 409 }));
    const save = await screen.findByRole('button', { name: 'Save configuration' });
    await waitFor(() => expect(save).toBeEnabled());
    await setup.user.click(save);
    await screen.findByText(/could not save ai configuration/i);
    expect(screen.getByRole('button', { name: /^Continue/ })).toBeDisabled();
    expect(setup.boundary.saved.size).toBe(0);
  });

  it('requires consent for the current cloud key after an unverified draft changes', async () => {
    const setup = wizard('claude', false);
    setup.requireConfirmation();
    const input = await screen.findByLabelText('Claude API key');
    await waitFor(() => expect(input).toBeEnabled());
    await setup.user.type(input, 'abandoned-cloud-key');
    await setup.user.click(screen.getByRole('button', { name: 'Save key' }));
    await screen.findByRole('button', { name: 'Save without verification' });
    await setup.user.clear(input);
    await setup.user.type(input, 'approved-cloud-key');
    expect(
      screen.queryByRole('button', { name: 'Save without verification' })
    ).not.toBeInTheDocument();
    await setup.user.click(screen.getByRole('button', { name: 'Save key' }));
    await setup.user.click(
      await screen.findByRole('button', { name: 'Save without verification' })
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^Continue/ })).toBeEnabled());
    expect(setup.boundary.saved.get('ai-keys:anthropic')).toEqual({ apiKey: 'approved-cloud-key' });
    const drafts = setup.writes.map(({ options }) => JSON.parse(String(options.body)));
    expect(drafts[1].operationId).not.toBe(drafts[0].operationId);
    expect(drafts[2]).toEqual({ ...drafts[1], allowUnverified: true });
    expect(setup.writes.every(({ url }) => url.endsWith('/ai-keys'))).toBe(true);
  });
});
