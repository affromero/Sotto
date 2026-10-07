import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createSseShutdownRegistry, getSseShutdownSignal } from '@/lib/sse/shutdown';

describe('SSE shutdown registry', () => {
  it('installs one idempotent process-signal listener and aborts late users immediately', () => {
    const signals = new EventEmitter();
    const registry = createSseShutdownRegistry();

    registry.install(signals);
    registry.install(signals);

    expect(signals.listenerCount('SIGTERM')).toBe(1);
    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(registry.signal.aborted).toBe(false);

    signals.emit('SIGTERM');
    expect(registry.signal.aborted).toBe(true);
    expect(registry.signal.reason).toBeInstanceOf(Error);

    signals.emit('SIGINT');
    expect(registry.signal.aborted).toBe(true);
  });

  it('installs process listeners synchronously on first signal acquisition and reuses them', () => {
    const key = Symbol.for('sotto.server.sse-shutdown');
    const shared = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
    const previousRegistry = shared[key];
    delete shared[key];

    const listeners = new EventEmitter();
    const on = vi.spyOn(process, 'on');
    on.mockImplementation(((signal: string | symbol, listener: (...args: never[]) => void) => {
      if (signal === 'SIGTERM' || signal === 'SIGINT') listeners.on(signal, () => listener());
      return process;
    }) as typeof process.on);

    try {
      const first = getSseShutdownSignal();
      const second = getSseShutdownSignal();

      expect(second).toBe(first);
      expect(listeners.listenerCount('SIGTERM')).toBe(1);
      expect(listeners.listenerCount('SIGINT')).toBe(1);
      expect(first.aborted).toBe(false);

      listeners.emit('SIGTERM');

      expect(first.aborted).toBe(true);
      expect(first.reason).toBeInstanceOf(Error);
    } finally {
      on.mockRestore();
      if (previousRegistry === undefined) delete shared[key];
      else shared[key] = previousRegistry;
    }
  });
});
