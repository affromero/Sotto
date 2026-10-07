const registryKey = Symbol.for('sotto.server.sse-shutdown');
type SignalSource = {
  on: (signal: 'SIGTERM' | 'SIGINT', listener: () => void) => unknown;
};

export type SseShutdownRegistry = {
  signal: AbortSignal;
  install: (source: SignalSource) => void;
};

export function createSseShutdownRegistry(): SseShutdownRegistry {
  const controller = new AbortController();
  let installedSource: SignalSource | undefined;
  const shutdown = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('Server is shutting down'));
    }
  };

  return {
    signal: controller.signal,
    install(source) {
      if (installedSource === source) return;
      if (installedSource) throw new Error('SSE shutdown handlers are already installed');
      installedSource = source;
      source.on('SIGTERM', shutdown);
      source.on('SIGINT', shutdown);
    },
  };
}

function registry(): SseShutdownRegistry {
  const shared = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  const existing = shared[registryKey] as SseShutdownRegistry | undefined;
  if (existing) return existing;

  const created = createSseShutdownRegistry();
  shared[registryKey] = created;
  return created;
}

export function getSseShutdownSignal(): AbortSignal {
  const shared = registry();
  shared.install(process);
  return shared.signal;
}
