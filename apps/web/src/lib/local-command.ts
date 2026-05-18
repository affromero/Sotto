import { spawn } from 'child_process';

const commandAvailabilityCache = new Map<string, boolean>();

export function resetCommandAvailabilityCache() {
  commandAvailabilityCache.clear();
}

export function isCommandAvailable(command: string, timeoutMs = 3000): Promise<boolean> {
  const cached = commandAvailabilityCache.get(command);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const child = spawn(command, ['--help'], { stdio: 'ignore' });
    let settled = false;

    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      commandAvailabilityCache.set(command, available);
      resolve(available);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(false);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });

    child.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}
