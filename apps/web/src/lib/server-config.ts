import { getSiteConfig, type ServerInfraConfig } from './site-config';

type InfraKey = keyof ServerInfraConfig;
let snapshot: ServerInfraConfig | null = null;

/** Refresh and return the authoritative shared configuration. Read failures are surfaced. */
export async function getServerInfra(): Promise<ServerInfraConfig> {
  snapshot = await getSiteConfig();
  return snapshot;
}

/** Sync constructors read only a snapshot explicitly warmed by their async boundary. */
export function infra(key: InfraKey): string | undefined {
  if (!snapshot)
    throw new Error('Shared server configuration was not loaded before provider construction');
  return snapshot[key]?.trim() || undefined;
}

export function invalidateServerInfra(): void {
  snapshot = null;
}
