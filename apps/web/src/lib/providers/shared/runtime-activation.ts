import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';

const activationSchema = z
  .object({ releaseSha: z.string().regex(/^[a-f0-9]{40}$/), fishEnabled: z.boolean() })
  .strict();
const MAX_BYTES = 1024;

export class ProviderActivationPendingError extends AccessError {
  constructor() {
    super('conflict', 'Fish Audio is being enabled. Try again shortly.');
  }
}

/** A read-only deployment mount defers new provider state until old HTTP retires. */
export function assertProviderActivated(provider: string): void {
  if (provider !== 'fish') return;
  const path = process.env.SOTTO_PROVIDER_ACTIVATION_FILE;
  if (path === undefined) return;
  let descriptor: number | undefined;
  try {
    if (!path) throw new Error('Missing activation file');
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error('Invalid activation file');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length > MAX_BYTES) throw new Error('Activation file exceeds its bound');
    const activation = activationSchema.parse(JSON.parse(bytes.subarray(0, length).toString()));
    if (activation.releaseSha !== process.env.SOTTO_RELEASE_SHA || !activation.fishEnabled)
      throw new Error('Provider activation is pending');
  } catch {
    throw new ProviderActivationPendingError();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
