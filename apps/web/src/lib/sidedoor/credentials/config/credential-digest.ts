import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Compare drafts within one browser lifetime without retaining their plaintext. */
export class CredentialDraftDigest {
  private readonly key = crypto.getRandomValues(new Uint8Array(32));

  digest(fields: readonly unknown[]): string {
    const bytes = new TextEncoder().encode(JSON.stringify(fields));
    return bytesToHex(hmac(sha256, this.key, bytes));
  }
}
