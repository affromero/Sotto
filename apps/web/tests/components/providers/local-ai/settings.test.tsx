import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalAiSettings } from '@/components/settings/LocalAiSettings';
import { settingsHttp } from './settings-http';

afterEach(() => vi.unstubAllGlobals());

async function openSettings() {
  const http = settingsHttp();
  vi.stubGlobal('fetch', http.fetch);
  const view = render(
    <LocalAiSettings initialBaseUrl="https://inference.example/v1" initialModel="tutor" />
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add API key' })).toBeEnabled());
  return { http, user: userEvent.setup(), ...view };
}

describe('editing a compatible model connection', () => {
  it('normalizes configuration before enabling a separately authenticated key write', async () => {
    const { http, user } = await openSettings();
    await user.clear(screen.getByLabelText('Endpoint URL'));
    await user.type(screen.getByLabelText('Endpoint URL'), ' https://second.example/api/v1 ');
    await user.type(screen.getByLabelText('Model ID'), '-revised');
    expect(screen.getByRole('button', { name: 'Add API key' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save server settings' }));
    await screen.findByText('AI server settings saved.');
    await user.click(screen.getByRole('button', { name: 'Add API key' }));
    await user.type(screen.getByLabelText('New API key'), 'secret-for-second');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));
    await screen.findByText('Key saved and verified.');
    const [configuration, key] = http.writes;
    expect(JSON.parse(String(configuration.options.body))).toEqual({
      aiProvider: 'local',
      aiBaseUrl: 'https://second.example/api/v1',
      aiModel: 'tutor-revised',
    });
    expect(JSON.parse(String(key.options.body))).toMatchObject({
      provider: 'local',
      values: { apiKey: 'secret-for-second' },
      expectedRevision: null,
    });
    expect(new Headers(key.options.headers).get('x-sotto-reviewed-ai-endpoint')).toBe(
      'https://second.example/api/v1'
    );
    expect(screen.queryByLabelText('New API key')).not.toBeInTheDocument();
  });

  it('requires a successful configuration write before credentials can be edited', async () => {
    const { http, user } = await openSettings();
    http.configure(async () => Response.json({}, { status: 403 }));
    await user.type(screen.getByLabelText('Model ID'), '-denied');
    await user.click(screen.getByRole('button', { name: 'Save server settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(screen.getByRole('button', { name: 'Add API key' })).toBeDisabled();
    expect(http.writes.map(({ url }) => url)).toEqual(['/api/v1/admin/site-config']);
  });

  it('cancels its configuration lifetime and prevents edits while the server responds', async () => {
    const { http, user, unmount } = await openSettings();
    const pending = Promise.withResolvers<Response>();
    http.configure(() => pending.promise);
    await user.type(screen.getByLabelText('Model ID'), '-pending');
    await user.click(screen.getByRole('button', { name: 'Save server settings' }));
    expect(screen.getByLabelText('Endpoint URL')).toBeDisabled();
    expect(screen.getByLabelText('Model ID')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add API key' })).toBeDisabled();
    const { signal } = http.writes[0].options;
    unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(Response.json({}));
  });

  it('removes plaintext from the editor before the credential response arrives', async () => {
    const { http, user } = await openSettings();
    const pending = Promise.withResolvers<void>();
    http.mutate(() => pending.promise);
    await user.click(screen.getByRole('button', { name: 'Add API key' }));
    await user.type(screen.getByLabelText('New API key'), 'one-use-draft');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));
    expect(screen.getByLabelText('New API key')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    pending.resolve();
    await screen.findByText('Key saved and verified.');
  });

  it('drops an unverified operation when the connection changes and requires a new review', async () => {
    const { http, user } = await openSettings();
    http.inconclusive();
    await user.click(screen.getByRole('button', { name: 'Add API key' }));
    await user.type(screen.getByLabelText('New API key'), 'not-yet-approved');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));
    await screen.findByRole('button', { name: 'Save without verification' });
    await user.type(screen.getByLabelText('Endpoint URL'), '/replacement');
    expect(
      screen.queryByRole('button', { name: 'Save without verification' })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New API key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save server settings' }));
    await screen.findByText('AI server settings saved.');
    await user.click(screen.getByRole('button', { name: 'Add API key' }));
    await user.type(screen.getByLabelText('New API key'), 'reviewed-replacement');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));
    await user.click(await screen.findByRole('button', { name: 'Save without verification' }));
    await screen.findByText('Key saved without verification.');
    const commands = http.writes.filter(({ url }) => url.endsWith('/ai-keys'));
    const bodies = commands.map(({ options }) => JSON.parse(String(options.body)));
    expect(bodies[0].operationId).not.toBe(bodies[1].operationId);
    expect(bodies[2]).toEqual({ ...bodies[1], allowUnverified: true });
    expect(new Headers(commands[2].options.headers).get('x-sotto-reviewed-ai-endpoint')).toBe(
      'https://inference.example/v1/replacement'
    );
  });
});
