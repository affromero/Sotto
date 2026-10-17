'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { resumeEndpoint } from '@/app/welcome/session/resume-security';
import styles from './LocalSpeechPicker.module.css';

const catalogueSchema = z.object({
  engine: z.string().max(80).nullable(),
  model: z.object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  }),
  voices: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(160),
        language: z.string().min(1).max(35).optional(),
      })
    )
    .min(1)
    .max(128)
    .refine((voices) => new Set(voices.map((voice) => voice.id)).size === voices.length),
});
type Catalogue = z.infer<typeof catalogueSchema>;

export interface LocalSpeechDraft {
  endpoint: string;
  model: string;
  voices: string[];
}

interface LocalSpeechPickerProps extends LocalSpeechDraft {
  onChange: (draft: Partial<LocalSpeechDraft>) => void;
  disabled?: boolean;
}

type AudioPreview = { key: string; url: string; voice: string };
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

function languageLabel(language?: string): string {
  if (!language) return 'Language not provided';
  try {
    const name = new Intl.DisplayNames(undefined, { type: 'language' }).of(language);
    return name && name !== language ? `${name} (${language})` : language;
  } catch {
    return language;
  }
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  return new Error(
    body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : fallback
  );
}

async function audioBlob(response: Response, signal: AbortSignal): Promise<Blob> {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The speech server returned no audio.');
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (!type.startsWith('audio/')) throw new Error('The speech server returned invalid audio.');
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new Error('The voice preview is too large.');
      chunks.push(new Uint8Array(value).buffer);
    }
    signal.throwIfAborted();
    if (!size) throw new Error('The speech server returned empty audio.');
    return new Blob(chunks, { type });
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel();
    reader.releaseLock();
  }
}

function PreviewAudio({ preview }: { preview: AudioPreview }) {
  const element = useRef<HTMLAudioElement>(null);
  const [pressPlay, setPressPlay] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const audio = element.current;
    if (!audio) return;
    let active = true;
    void audio.play().catch(() => {
      if (active) setPressPlay(true);
    });
    return () => {
      active = false;
      audio.pause();
    };
  }, []);
  return (
    <div className={styles.preview}>
      <p>Preview: {preview.voice}</p>
      <audio
        ref={element}
        controls
        src={preview.url}
        aria-label={`Voice preview: ${preview.voice}`}
        onPlay={() => setPressPlay(false)}
        onError={() => setFailed(true)}
      />
      {pressPlay && <p role="status">Press play to hear this voice.</p>}
      {failed && <p role="alert">This preview could not play. Try Listen again.</p>}
    </div>
  );
}

export function LocalSpeechPicker({
  endpoint,
  model,
  voices,
  onChange,
  disabled = false,
}: LocalSpeechPickerProps) {
  const key = JSON.stringify([endpoint.trim(), model.trim()]);
  const [catalogue, setCatalogue] = useState<{
    key: string;
    data: Catalogue;
  } | null>(null);
  const [activity, setActivity] = useState<{
    key: string;
    voice?: string;
  } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [audio, setAudio] = useState<AudioPreview | null>(null);
  const [draftKey, setDraftKey] = useState(key);
  if (draftKey !== key) {
    setDraftKey(key);
    setActivity(null);
    setError(null);
    setAudio(null);
    if (catalogue?.key !== key) setCatalogue(null);
  }
  const discovery = useRef<AbortController | null>(null);
  const preview = useRef<AbortController | null>(null);
  const ownedUrl = useRef<string | null>(null);
  const disposeAudio = useCallback(() => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
  }, []);
  useEffect(
    () => () => {
      discovery.current?.abort();
      preview.current?.abort();
      disposeAudio();
    },
    [key, disposeAudio]
  );

  const current = catalogue?.key === key ? catalogue.data : null;
  const pending = activity?.key === key ? activity : null;
  const selected = new Set(voices.filter(Boolean));
  const unavailable = [...selected].filter(
    (id) => !current?.voices.some((voice) => voice.id === id)
  );

  async function findVoices() {
    if (!resumeEndpoint(endpoint.trim())) {
      setError({
        key,
        message: 'Enter a valid speech endpoint in Advanced settings.',
      });
      return;
    }
    discovery.current?.abort();
    preview.current?.abort();
    disposeAudio();
    setAudio(null);
    const controller = new AbortController();
    discovery.current = controller;
    setActivity({ key });
    setError(null);
    try {
      const response = await fetch('/api/v1/settings/local-speech/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpoint.trim() }),
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, 'Could not connect to local speech.');
      const parsed = catalogueSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('The speech server returned an invalid voice list.');
      if (controller.signal.aborted || discovery.current !== controller) return;
      const nextModel = model.trim() || parsed.data.model.id;
      setCatalogue({
        key: JSON.stringify([endpoint.trim(), nextModel]),
        data: parsed.data,
      });
      if (!model.trim()) onChange({ model: nextModel });
    } catch (failure) {
      if (!controller.signal.aborted && discovery.current === controller)
        setError({
          key,
          message: failure instanceof Error ? failure.message : 'Could not find voices.',
        });
    } finally {
      if (discovery.current === controller && !controller.signal.aborted) setActivity(null);
    }
  }

  async function listen(voice: Catalogue['voices'][number]) {
    preview.current?.abort();
    disposeAudio();
    setAudio(null);
    const controller = new AbortController();
    preview.current = controller;
    setActivity({ key, voice: voice.id });
    setError(null);
    try {
      const response = await fetch('/api/v1/settings/local-speech/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          model: model.trim(),
          voiceId: voice.id,
          ...(voice.language ? { language: voice.language } : {}),
          text: 'Sotto. 1, 2, 3.',
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, 'Could not preview this voice.');
      const blob = await audioBlob(response, controller.signal);
      if (controller.signal.aborted || preview.current !== controller) return;
      const url = URL.createObjectURL(blob);
      ownedUrl.current = url;
      setAudio({ key, url, voice: voice.name });
    } catch (failure) {
      if (!controller.signal.aborted && preview.current === controller)
        setError({
          key,
          message: failure instanceof Error ? failure.message : 'Could not preview this voice.',
        });
    } finally {
      if (preview.current === controller && !controller.signal.aborted) setActivity(null);
    }
  }

  function toggle(id: string) {
    onChange({
      endpoint,
      model,
      voices: selected.has(id) ? voices.filter((voice) => voice !== id) : [...voices, id],
    });
  }

  return (
    <div className={styles.root}>
      <div className={styles.connect}>
        <div>
          <h3>Local voices</h3>
          <p>Find your server’s voices, listen, then choose 2 to 8.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void findVoices()}
          disabled={disabled || (pending !== null && !pending.voice)}
          loading={pending !== null && !pending.voice}
        >
          Find voices
        </Button>
      </div>
      {current && (
        <p role="status">
          Connected{current.engine ? `: ${current.engine}` : ''}. {current.voices.length} voices
          available.
        </p>
      )}
      <fieldset className={styles.choices} disabled={disabled}>
        <legend>Choose voices ({selected.size}/8 selected)</legend>
        {current?.voices.map((voice) => (
          <div key={voice.id} className={styles.voice}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(voice.id)}
                disabled={!selected.has(voice.id) && selected.size >= 8}
                onChange={() => toggle(voice.id)}
              />
              <span>
                <strong>{voice.name}</strong>
                <span className={styles.language}>{languageLabel(voice.language)}</span>
              </span>
            </label>
            <Button
              type="button"
              variant="secondary"
              size="small"
              aria-label={`Listen to ${voice.name}`}
              disabled={
                disabled ||
                !model.trim() ||
                Boolean(pending && !pending.voice) ||
                pending?.voice === voice.id
              }
              loading={pending?.voice === voice.id}
              onClick={() => void listen(voice)}
            >
              Listen
            </Button>
          </div>
        ))}
        {unavailable.map((id) => (
          <label key={id} className={styles.unavailable}>
            <input type="checkbox" checked onChange={() => toggle(id)} />
            <span>
              <strong>{id}</strong>
              <span className={styles.language}>
                {current
                  ? 'Not listed by this server. Uncheck to remove.'
                  : 'Saved voice ID. Find voices to check availability.'}
              </span>
            </span>
          </label>
        ))}
        {selected.size < 2 && <p>Choose at least two distinct voices before saving.</p>}
      </fieldset>
      {audio?.key === key && <PreviewAudio key={audio.url} preview={audio} />}
      {error?.key === key && (
        <p role="alert" className={styles.error}>
          {error.message}
        </p>
      )}
      <details className={styles.advanced}>
        <summary>Advanced settings</summary>
        <div className={styles.fields}>
          <Input
            label="Speech endpoint URL"
            type="url"
            maxLength={512}
            value={endpoint}
            disabled={disabled}
            onChange={(event) => onChange({ endpoint: event.target.value, model, voices })}
            helperText="Use the address reachable by this Sotto server."
          />
          <Input
            label="Local speech model ID"
            maxLength={128}
            value={model}
            disabled={disabled}
            onChange={(event) => onChange({ endpoint, model: event.target.value, voices })}
            helperText={
              current
                ? `Server model: ${current.model.label} (${current.model.id}). Custom models stay unchanged.`
                : 'Find voices to use the server model, or enter a custom model.'
            }
          />
          <Input
            label="Local voice IDs"
            maxLength={512}
            value={voices.join(',')}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                endpoint,
                model,
                voices: event.target.value.split(',').map((voice) => voice.trim()),
              })
            }
            helperText="Manual IDs, separated by commas. Existing IDs stay selected until you remove them."
          />
        </div>
      </details>
    </div>
  );
}
