import { createHash } from 'node:crypto';
import type { SottoExecutionCredential } from '@/lib/sidedoor/credentials/runtime/credential-execution';

/** Only immutable credential metadata is hashed. Secrets never enter durable task state. */
export function learningCredentialFingerprint(
  credential?: SottoExecutionCredential | null
): string | null {
  if (!credential) return null;
  const selected = credential.selected;
  return createHash('sha256')
    .update(
      JSON.stringify({
        recipient: credential.recipient,
        scope: credential.scope,
        provider: credential.provider,
        allowSharing: credential.allowSharing,
        binding: credential.binding,
        instanceId: selected.instanceId,
        ownerUserId: selected.ownerUserId,
        shared: selected.shared,
        sharingRevision: selected.sharingRevision,
        owner: selected.credential.owner,
        credentialRevision: selected.credential.credentialRevision,
        credentialBinding: selected.credential.binding,
      })
    )
    .digest('hex');
}
