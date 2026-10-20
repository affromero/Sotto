'use client';

import { useId, useState } from 'react';
import {
  playPhraseInputSchema,
  playPhraseViewSchema,
  playVisibleTexts,
  type PlayRoomView,
} from '@sotto/shared';
import { usePlayMutation } from './client/usePlayMutation';
import styles from './PhraseCapture.module.css';

export function PhraseCapture({
  roomId,
  round,
}: {
  roomId: string;
  round: NonNullable<PlayRoomView['round']>;
}) {
  const id = useId();
  const sources = playVisibleTexts(round);
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'WORD' | 'PHRASE' | 'SENTENCE'>('PHRASE');
  const [saved, setSaved] = useState(false);
  const mutation = usePlayMutation(playPhraseViewSchema);
  if (sources.length === 0) return null;
  const valid = text.trim().length > 0 && source.includes(text.trim());
  return (
    <details className={styles.root}>
      <summary>Keep a word or sentence</summary>
      <p>Save language from this round to your private notebook.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || mutation.pending) return;
          void mutation
            .run('/api/v1/play/phrases', {
              roomId,
              roundId: round.id,
              kind,
              text: text.trim(),
              contextText: source === text.trim() ? null : source,
            })
            .then((phrase) => {
              if (phrase) setSaved(true);
            });
        }}
      >
        <label htmlFor={`${id}-source`}>
          Choose visible text
          <select
            id={`${id}-source`}
            value={source}
            disabled={mutation.pending}
            onChange={(event) => {
              setSource(event.target.value);
              setText(event.target.value);
              setSaved(false);
            }}
          >
            <option value="">Choose text from this round</option>
            {sources.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-text`}>
          Keep the whole line or a part of it
          <textarea
            id={`${id}-text`}
            value={text}
            lang={round.targetLang}
            rows={2}
            maxLength={500}
            disabled={mutation.pending}
            onChange={(event) => {
              setText(event.target.value);
              setSaved(false);
            }}
            required
          />
        </label>
        <label htmlFor={`${id}-kind`}>
          Save as
          <select
            id={`${id}-kind`}
            value={kind}
            disabled={mutation.pending}
            onChange={(event) => {
              setKind(playPhraseInputSchema.shape.kind.parse(event.target.value));
              setSaved(false);
            }}
          >
            <option value="WORD">Word</option>
            <option value="PHRASE">Phrase</option>
            <option value="SENTENCE">Sentence</option>
          </select>
        </label>
        {text.trim() && !valid && <p role="alert">Choose an exact part of the visible text.</p>}
        <button type="submit" disabled={!valid || mutation.pending}>
          {mutation.pending ? 'Saving…' : 'Save to notebook'}
        </button>
      </form>
      {mutation.error && <p role="alert">{mutation.error}</p>}
      {mutation.uncertain && (
        <button
          type="button"
          disabled={mutation.busy}
          onClick={() => {
            void mutation.retry();
          }}
        >
          Retry the same save
        </button>
      )}
      {saved && <p role="status">Saved to your private notebook.</p>}
    </details>
  );
}
