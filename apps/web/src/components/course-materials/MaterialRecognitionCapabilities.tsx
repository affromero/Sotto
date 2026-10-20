'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  browserCapabilitySchema,
  recognitionRegistrySchema,
  materialResponse,
  type RecognitionRegistry,
} from '@/lib/course-materials/client/processing-contracts';
import styles from './MaterialRecognitionCapabilities.module.css';

interface Props {
  providers: Array<{
    id: string;
    displayName: string;
    models: Array<{ id: string; displayName: string }>;
  }>;
}
const endpoint = '/api/v1/admin/material-recognition-capabilities';

/** Owner authorization and immutable review versions are enforced by the canonical registry API. */
export function MaterialRecognitionCapabilities({ providers }: Props) {
  const [registry, setRegistry] = useState<RecognitionRegistry | null>(null);
  const [provider, setProvider] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<{ method: 'POST' | 'PATCH'; body: string } | null>(null);

  async function refresh(signal?: AbortSignal) {
    try {
      const result = recognitionRegistrySchema.parse(
        await materialResponse(await fetch(endpoint, { signal, cache: 'no-store' }))
      );
      setRegistry(result);
      setError('');
    } catch (failure) {
      if (!signal?.aborted)
        setError(
          failure instanceof Error ? failure.message : 'Could not read recognition reviews.'
        );
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    void (async () => {
      await refresh(controller.signal);
    })();
    return () => controller.abort();
  }, []);

  async function write(value: { method: 'POST' | 'PATCH'; body: string }) {
    setPending(value);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, {
        ...value,
        headers: { 'Content-Type': 'application/json' },
        signal: lifecycle.current?.signal,
      });
      const knownFailure = !response.ok;
      const body = await materialResponse(response).catch((failure: unknown) => {
        if (knownFailure) setPending(null);
        throw failure;
      });
      setRegistry(recognitionRegistrySchema.parse(body));
      setPending(null);
      setConfirmed(false);
      setNotice(
        value.method === 'POST'
          ? 'Capability review saved. Recognition still requires an explicit material request.'
          : 'Review revoked. Saved responses remain retained.'
      );
    } catch (failure) {
      if (!lifecycle.current?.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : 'Could not save the capability review.'
        );
    } finally {
      setBusy(false);
    }
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registry || !confirmed || pending) return;
    const form = new FormData(event.currentTarget);
    try {
      const capability = browserCapabilitySchema.parse({
        schemaVersion: 1,
        source: 'REVIEWED_MODEL_CAPABILITY',
        reviewId: form.get('reviewId'),
        revision: form.get('revision'),
        provider,
        model: form.get('model'),
        endpoint: String(form.get('endpoint') ?? '').trim() || null,
        vision: true,
        handwriting: true,
        maxImages: Number(form.get('maxImages')),
        maxDecodedBytes: Number(form.get('maxDecodedBytes')),
        minimumDpi: Number(form.get('minimumDpi')),
        maxOutputTokens: Number(form.get('maxOutputTokens')),
      });
      if (capability.minimumDpi > 288)
        throw new Error('This page renderer supports at most 288 DPI.');
      await write({
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: registry.revision,
          operatorConfirmed: true,
          capability,
          documentationUrl: form.get('documentationUrl'),
        }),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Review every capability field.');
    }
  }

  return (
    <section
      className={styles.root}
      id="material-recognition"
      aria-labelledby="recognition-heading"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Owner capability registry</p>
          <h2 id="recognition-heading">Document recognition</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh(lifecycle.current?.signal)}
        >
          Refresh capability reviews
        </button>
      </header>
      <p>
        Review image and handwriting support for an exact model and endpoint. A review enables
        explicit document requests. It does not change the selected provider or send images.
      </p>
      <p className={styles.note}>
        Runtime limits: up to 5 images, 2,000,000 decoded image bytes and 4 MiB serialized transport
        per page request. The current renderer supports 72 to 288 DPI. A page that cannot fit
        remains unresolved.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!registry && !error && <p role="status">Reading capability reviews</p>}
      {pending && !busy && (
        <div className={styles.recovery}>
          <p>
            The response was interrupted. Retry the preserved review version or revocation before
            creating another change.
          </p>
          <button type="button" onClick={() => void write(pending)}>
            Retry saved registry request
          </button>
        </div>
      )}
      {registry && (
        <>
          <ul className={styles.reviews}>
            {registry.capabilities.map((record) => (
              <li key={`${record.capability.reviewId}:${record.capability.revision}`}>
                <strong>
                  {record.capability.provider} / {record.capability.model}
                </strong>
                <p>
                  {record.capability.endpoint ?? 'Provider default endpoint'} · Review{' '}
                  {record.capability.reviewId}, version {record.capability.revision} ·{' '}
                  {record.active ? 'Active' : 'Revoked'}
                </p>
                <p>
                  {record.capability.minimumDpi} DPI minimum · {record.capability.maxImages} images
                  · {record.capability.maxDecodedBytes.toLocaleString()} decoded bytes ·{' '}
                  {record.capability.maxOutputTokens.toLocaleString()} output tokens
                </p>
                <a href={record.documentationUrl} target="_blank" rel="noreferrer">
                  Reviewed model documentation
                </a>
                {record.active && (
                  <button
                    type="button"
                    disabled={busy || !!pending}
                    onClick={() =>
                      void write({
                        method: 'PATCH',
                        body: JSON.stringify({
                          expectedRevision: registry.revision,
                          reviewId: record.capability.reviewId,
                          revision: record.capability.revision,
                          active: false,
                        }),
                      })
                    }
                  >
                    Revoke {record.capability.reviewId} {record.capability.revision}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!registry.capabilities.length && (
            <p>
              No reviewed recognition capabilities. Learners can retain originals and inspect
              embedded text.
            </p>
          )}
          <form onSubmit={(event) => void review(event)}>
            <fieldset disabled={busy || !!pending}>
              <legend>Publish an immutable capability review</legend>
              <div className={styles.fields}>
                <label>
                  Provider
                  <select
                    name="provider"
                    required
                    value={provider}
                    onChange={(event) => setProvider(event.target.value)}
                  >
                    <option value="">Choose configured provider type</option>
                    {providers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Exact model ID
                  <input name="model" required maxLength={200} list="recognition-models" />
                </label>
                <datalist id="recognition-models">
                  {providers
                    .find((item) => item.id === provider)
                    ?.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                </datalist>
                <label>
                  Exact endpoint, when configured
                  <input
                    name="endpoint"
                    type="url"
                    maxLength={2048}
                    placeholder="Leave empty for the provider default"
                  />
                </label>
                <label>
                  Model documentation URL
                  <input
                    name="documentationUrl"
                    type="url"
                    required
                    maxLength={2048}
                    placeholder="https://"
                  />
                </label>
                <label>
                  Review ID
                  <input name="reviewId" required maxLength={200} />
                </label>
                <label>
                  Review version
                  <input name="revision" required maxLength={200} />
                </label>
                <label>
                  Maximum images
                  <input name="maxImages" type="number" min={1} max={5} defaultValue={5} required />
                </label>
                <label>
                  Maximum decoded image bytes
                  <input
                    name="maxDecodedBytes"
                    type="number"
                    min={1}
                    max={2000000}
                    defaultValue={2000000}
                    required
                  />
                </label>
                <label>
                  Minimum DPI
                  <input
                    name="minimumDpi"
                    type="number"
                    min={72}
                    max={288}
                    defaultValue={144}
                    required
                  />
                </label>
                <label>
                  Maximum output tokens
                  <input
                    name="maxOutputTokens"
                    type="number"
                    min={256}
                    max={32768}
                    defaultValue={16384}
                    required
                  />
                </label>
              </div>
              <p className={styles.note}>
                Match the exact configured model identifier, including any selected effort, and its
                base endpoint. Changing either requires a separate review. Revoke an active review
                before publishing another version for the same selection.
              </p>
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed the documentation and confirm image input and handwriting support at
                these limits.
              </label>
              <button type="submit" disabled={!confirmed || !provider}>
                Save reviewed capability
              </button>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}
