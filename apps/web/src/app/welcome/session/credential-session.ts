import {
  prepareCredentialSave,
  sameCredentialEditContext,
  type CredentialRemovalRequest,
  type CredentialSaveDraft,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';
import { providerCredentials, providerIdentity } from 'thesidedoor-core/providers/catalog';
import { CredentialDraftDigest } from '@/lib/sidedoor/credentials/config/credential-digest';
import {
  CredentialReconciliationError,
  captureCredentialReceipt,
  loadCredentialSettings,
  reconcileCredentialSettings,
  saveCredentialSettings,
  type CredentialEndpoint,
  type CredentialMutationResult,
} from '@/lib/sidedoor/credentials/config/credential-browser';
import type { KeyPost } from '@/app/welcome/providerMap';
import {
  credentialSelectionEnvelopeSchema,
  type CredentialSelectionEnvelope,
} from '@/lib/sidedoor/credentials/config/credential-selection-contract';

interface Entry {
  endpoint: CredentialEndpoint;
  expectedEndpoint?: string;
  signature: string;
  receipt: CredentialRemovalRequest;
  draft?: CredentialSaveDraft;
  state: 'editing' | 'confirmation' | 'uncertain' | 'saved';
}
export type WelcomeCredentialResult =
  | { status: 'ready' }
  | {
      status: 'confirmation' | 'uncertain' | 'review';
      message: string;
      operationId?: string;
      clearSecrets?: boolean;
    };

export class WelcomeCredentialContextError extends Error {}

/** Merge aliases before any write. A physical credential slot cannot contain two different keys. */
function groupedEdits(posts: readonly KeyPost[]) {
  const grouped = new Map<
    string,
    {
      endpoint: CredentialEndpoint;
      provider: string;
      baseUrl?: string;
      values: Record<string, string | number | boolean>;
    }
  >();
  for (const post of posts) {
    const modality =
      post.endpoint === 'ai-keys'
        ? providerIdentity(post.provider).modalities.includes('text')
          ? 'text'
          : 'transcription'
        : post.endpoint === 'visual-cues'
          ? 'visual'
          : post.provider === 'suno'
            ? 'music'
            : 'speech';
    const metadata = providerCredentials(post.provider, modality);
    const fields = [...metadata.fields, ...metadata.configurationFields];
    const slot = `${post.endpoint}:${post.provider}`;
    const edit = grouped.get(slot) ?? {
      endpoint: post.endpoint,
      provider: post.provider,
      baseUrl: post.baseUrl,
      values: {},
    };
    if (edit.baseUrl !== post.baseUrl)
      throw new Error(
        `The ${post.provider} selections contain different endpoints. Review them before saving.`
      );
    for (const [name, raw] of Object.entries({ apiKey: post.apiKey, ...post.extra })) {
      const field = fields.find((candidate) => candidate.id === name);
      if (!field) throw new Error(`Unknown credential field for ${post.provider}`);
      if (field.kind === 'boolean' && raw !== 'true' && raw !== 'false')
        throw new Error(`Check ${field.label} for ${post.provider}.`);
      const value =
        field.kind === 'number' ? Number(raw) : field.kind === 'boolean' ? raw === 'true' : raw;
      if (Object.hasOwn(edit.values, name) && edit.values[name] !== value)
        throw new Error(
          `The ${post.provider} selections contain different ${field.label} values. Review them before saving.`
        );
      edit.values[name] = value;
    }
    grouped.set(slot, edit);
  }
  return grouped;
}

/** One wizard lifetime owns displayed revisions and receipts, including placement and final retries. */
export class WelcomeCredentialSession {
  private readonly snapshots = new Map<CredentialEndpoint, CredentialSettingsSnapshot>();
  private readonly entries = new Map<string, Entry>();
  private pendingSlots = new Set<string>();
  private busy = false;
  private editVersion = 0;
  private readonly drafts = new CredentialDraftDigest();

  private signature(edit: {
    endpoint: CredentialEndpoint;
    provider: string;
    baseUrl?: string;
    values: Record<string, string | number | boolean>;
  }): string {
    return this.drafts.digest([
      edit.endpoint,
      edit.provider,
      edit.baseUrl ?? null,
      Object.entries(edit.values).sort(([left], [right]) => left.localeCompare(right)),
    ]);
  }

  savedProviders(endpoint: CredentialEndpoint): string[] {
    return (
      this.snapshots
        .get(endpoint)
        ?.keys.filter((key) => key.isValid)
        .map((key) => key.provider) ?? []
    );
  }

  savedStatus(endpoint: CredentialEndpoint, provider: string): 'verified' | 'saved' | null {
    const key = this.snapshots.get(endpoint)?.keys.find((key) => key.provider === provider);
    if (!key?.isValid) return null;
    return key.verification.lastConfirmed?.status === 'verified' ? 'verified' : 'saved';
  }

  receiptStatus(post: KeyPost): 'verified' | 'saved' | null {
    const slot = `${post.endpoint}:${post.provider}`;
    const entry = this.entries.get(slot);
    const edit = groupedEdits([post]).get(slot);
    if (
      !edit ||
      entry?.state !== 'saved' ||
      this.snapshots.get(post.endpoint)?.heads[post.provider] !== entry.receipt.operationId
    )
      return null;
    const signature = this.signature(edit);
    return entry.signature === signature ? this.savedStatus(post.endpoint, post.provider) : null;
  }

  storedProviders(endpoint: CredentialEndpoint): string[] {
    return this.snapshots.get(endpoint)?.keys.map((key) => key.provider) ?? [];
  }

  captureSelections(
    selections: readonly { endpoint: CredentialEndpoint; provider: string }[]
  ): CredentialSelectionEnvelope {
    const context = this.snapshots.get('ai-keys')?.context;
    if (!context) throw new Error('Load credential settings before submitting setup.');
    const unique = new Map(
      selections.map((selection) => [`${selection.endpoint}:${selection.provider}`, selection])
    );
    return credentialSelectionEnvelopeSchema.parse({
      context: { instanceId: context.instanceId, owner: context.owner },
      selections: [...unique.values()].map((selection) => {
        const displayed = this.snapshots.get(selection.endpoint);
        if (!displayed || !Object.hasOwn(displayed.heads, selection.provider))
          throw new Error('The selected credential slot is unavailable.');
        return { ...selection, expectedRevision: displayed.heads[selection.provider] };
      }),
    });
  }

  /** Recheck every displayed provider selection against the saved credentials. */
  async verifySelections(
    selections: readonly { endpoint: CredentialEndpoint; provider: string }[],
    signal: AbortSignal
  ) {
    const endpoints = [...new Set(selections.map((selection) => selection.endpoint))];
    for (const endpoint of endpoints) {
      const displayed = this.snapshots.get(endpoint);
      if (!displayed) throw new Error('Load credential settings before continuing.');
      const current = await loadCredentialSettings(endpoint, signal);
      signal.throwIfAborted();
      if (!sameCredentialEditContext(displayed.context, current.context)) {
        this.entries.clear();
        this.snapshots.clear();
        throw new WelcomeCredentialContextError(
          'The active profile changed. Reload setup and enter credentials again.'
        );
      }
      for (const selection of selections.filter((selection) => selection.endpoint === endpoint)) {
        if (
          !Object.hasOwn(displayed.heads, selection.provider) ||
          !Object.hasOwn(current.heads, selection.provider)
        )
          throw new Error(
            `The ${selection.provider} credential slot is unavailable. Reload credentials before continuing.`
          );
        if (displayed.heads[selection.provider] !== current.heads[selection.provider])
          throw new Error(
            `The ${selection.provider} key changed. Reload credentials and review your selections.`
          );
        const key = current.keys.find((key) => key.provider === selection.provider);
        if (key && !key.isValid)
          throw new Error(
            `The ${selection.provider} key is disabled. Update it before continuing.`
          );
      }
    }
  }

  invalidateConfirmations() {
    this.editVersion++;
    for (const [slot, entry] of this.entries) {
      if (entry.state === 'confirmation') this.entries.delete(slot);
    }
  }

  private async reconcile(entry: Entry, signal: AbortSignal) {
    try {
      return await reconcileCredentialSettings(entry.endpoint, entry.receipt, 'save', signal);
    } catch (error) {
      signal.throwIfAborted();
      entry.state = 'uncertain';
      throw new CredentialReconciliationError(
        error instanceof Error && 'status' in error && typeof error.status === 'number'
          ? error.status
          : 503
      );
    }
  }

  async load(signal: AbortSignal) {
    if ([...this.entries.values()].some((entry) => entry.state === 'uncertain'))
      throw new Error('Check the pending credential change before reloading.');
    const endpoints: CredentialEndpoint[] = ['ai-keys', 'byok', 'visual-cues'];
    const snapshots = await Promise.all(
      endpoints.map((endpoint) => loadCredentialSettings(endpoint, signal))
    );
    signal.throwIfAborted();
    const first = snapshots[0]!;
    for (const snapshot of snapshots) {
      if (
        !sameCredentialEditContext(first.context, {
          ...snapshot.context,
          scope: first.context.scope,
        })
      ) {
        this.entries.clear();
        this.snapshots.clear();
        throw new WelcomeCredentialContextError(
          'The active profile changed. Reload setup before entering credentials.'
        );
      }
      const previous = this.snapshots.get(snapshot.context.scope as CredentialEndpoint);
      if (previous && !sameCredentialEditContext(previous.context, snapshot.context)) {
        this.entries.clear();
        this.snapshots.clear();
        throw new WelcomeCredentialContextError(
          'The active profile changed. Reload setup and enter credentials again.'
        );
      }
    }
    for (const snapshot of snapshots)
      this.snapshots.set(snapshot.context.scope as CredentialEndpoint, snapshot);
    for (const [slot, entry] of this.entries) {
      if (
        entry.state !== 'saved' ||
        this.snapshots.get(entry.endpoint)?.heads[entry.receipt.provider] !==
          entry.receipt.operationId
      )
        this.entries.delete(slot);
    }
  }

  private accept(entry: Entry, result: CredentialMutationResult): WelcomeCredentialResult {
    if (result.status !== 'needs_confirmation') delete entry.draft;
    if (result.status === 'confirmed') {
      entry.state = 'saved';
      const displayed = this.snapshots.get(entry.endpoint)!;
      // Only our own committed slot advances. Other dirty forms retain their displayed heads.
      this.snapshots.set(entry.endpoint, {
        ...displayed,
        heads: { ...displayed.heads, [entry.receipt.provider]: entry.receipt.operationId },
        keys: [
          ...displayed.keys.filter((key) => key.provider !== entry.receipt.provider),
          ...(result.key ? [result.key] : []),
        ],
      });
      return result.key?.isValid
        ? { status: 'ready' }
        : {
            status: 'review',
            message: `The saved ${entry.receipt.provider} key is disabled. Review its credentials before continuing.`,
          };
    }
    if (result.status === 'needs_confirmation') {
      if (!entry.draft) {
        this.entries.delete(`${entry.endpoint}:${entry.receipt.provider}`);
        return {
          status: 'review',
          message: 'Credentials changed. Review them before saving again.',
        };
      }
      entry.state = 'confirmation';
      return {
        status: 'confirmation',
        operationId: entry.receipt.operationId,
        message: `The provider could not verify ${entry.receipt.provider}. Review the credentials or explicitly save without verification.`,
      };
    }
    if (result.status === 'context_changed') {
      this.entries.clear();
      this.snapshots.clear();
      return {
        status: 'review',
        clearSecrets: true,
        message: 'The active profile changed. Reload setup and enter credentials again.',
      };
    }
    if (result.status === 'superseded') {
      entry.state = 'editing';
      return {
        status: 'review',
        message: `The ${entry.receipt.provider} key changed. Reload credentials and review your selections.`,
      };
    }
    entry.state = 'uncertain';
    return {
      status: 'uncertain',
      message: `The ${entry.receipt.provider} change needs its status checked before continuing.`,
    };
  }

  async save(
    posts: readonly KeyPost[],
    signal: AbortSignal,
    consentOperationId?: string
  ): Promise<WelcomeCredentialResult> {
    if (this.busy)
      return { status: 'review', message: 'Wait for the current credential change to finish.' };
    this.busy = true;
    try {
      const edits = groupedEdits(posts);
      for (const [slot, entry] of this.entries) {
        if (entry.state !== 'uncertain') continue;
        const result = await this.reconcile(entry, signal);
        const accepted = this.accept(entry, result);
        if (accepted.status !== 'ready' && (edits.has(slot) || result.status !== 'confirmed'))
          return accepted;
      }
      this.pendingSlots = new Set(edits.keys());
      for (const [slot, edit] of edits) {
        signal.throwIfAborted();
        const snapshot = this.snapshots.get(edit.endpoint);
        if (!snapshot) throw new Error('Load credential settings before entering keys.');
        const signature = this.signature(edit);
        let entry = this.entries.get(slot);
        if (entry && (entry.state === 'saved' || entry.state === 'uncertain')) {
          const previous = this.accept(entry, await this.reconcile(entry, signal));
          if (previous.status !== 'ready') return previous;
          if (entry.signature === signature) {
            this.pendingSlots.delete(slot);
            continue;
          }
        }
        if (!entry || entry.signature !== signature || entry.state === 'editing') {
          const current = this.snapshots.get(edit.endpoint)!;
          const patch = {
            ...edit.values,
            ...(edit.provider === 'cartesia' &&
            edit.values.usagePlan &&
            edit.values.usagePlan !== 'custom'
              ? { monthlyCreditLimit: null }
              : {}),
          };
          const draft = prepareCredentialSave(
            current,
            edit.provider,
            current.keys.some((key) => key.provider === edit.provider)
              ? { patch }
              : { values: edit.values }
          );
          entry = {
            endpoint: edit.endpoint,
            ...(edit.endpoint === 'ai-keys' && edit.provider === 'local' && edit.baseUrl
              ? { expectedEndpoint: edit.baseUrl }
              : {}),
            signature,
            state: 'editing',
            receipt: captureCredentialReceipt(draft),
            draft,
          };
          this.entries.set(slot, entry);
        }
        const confirmed =
          entry.state === 'confirmation' && consentOperationId === entry.receipt.operationId;
        const accepted = await this.submit(entry, confirmed, signal);
        if (accepted.status !== 'ready') return accepted;
        this.pendingSlots.delete(slot);
      }
      return { status: 'ready' };
    } finally {
      this.busy = false;
    }
  }

  private async submit(entry: Entry, confirmed: boolean, signal: AbortSignal) {
    const draft = entry.draft;
    if (!draft) throw new Error('Review credentials before saving again.');
    const version = this.editVersion;
    delete entry.draft;
    entry.state = 'uncertain';
    try {
      const result = await saveCredentialSettings(
        entry.endpoint,
        draft,
        confirmed,
        signal,
        entry.expectedEndpoint
      );
      signal.throwIfAborted();
      if (result.status === 'needs_confirmation' && version === this.editVersion)
        entry.draft = draft;
      return this.accept(entry, result);
    } catch (error) {
      if (!signal.aborted && !(error instanceof CredentialReconciliationError))
        entry.state = 'editing';
      throw error;
    }
  }

  async continuePending(
    signal: AbortSignal,
    operationId?: string
  ): Promise<WelcomeCredentialResult> {
    if (this.busy)
      return { status: 'review', message: 'Wait for the current credential change to finish.' };
    this.busy = true;
    try {
      for (const [slot, entry] of this.entries) {
        signal.throwIfAborted();
        if (entry.state === 'uncertain') {
          const result = this.accept(entry, await this.reconcile(entry, signal));
          if (result.status !== 'ready') return result;
          this.pendingSlots.delete(slot);
        } else if (entry.state === 'confirmation' && entry.receipt.operationId === operationId) {
          const result = await this.submit(entry, true, signal);
          if (result.status !== 'ready') return result;
          this.pendingSlots.delete(slot);
        } else if (entry.state === 'confirmation') {
          return this.accept(entry, { status: 'needs_confirmation' });
        }
      }
      if (this.pendingSlots.size)
        return {
          status: 'review',
          message:
            'Some selected credentials still need saving. Review the selections and save again.',
        };
      return { status: 'ready' };
    } finally {
      this.busy = false;
    }
  }
}
