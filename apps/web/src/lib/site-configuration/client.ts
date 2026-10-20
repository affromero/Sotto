import type { ServerInfraConfig } from '../site-config';

type AiServerConfiguration = Readonly<
  Partial<Pick<ServerInfraConfig, 'aiProvider' | 'aiModel' | 'aiBaseUrl'>>
>;

/** Save shared model configuration through the owner's authenticated route. */
export async function saveAiServerConfiguration(
  configuration: AiServerConfiguration,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch('/api/v1/admin/site-config', {
    method: 'PATCH',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(configuration),
  });
  signal.throwIfAborted();
  if (!response.ok)
    throw new Error('Could not save AI configuration. Review the server and try again.');
}
