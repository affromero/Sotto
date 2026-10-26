'use client';

import { useEffect, useRef, useState } from 'react';
import { episodeDetailResponseSchema } from '@sotto/shared';
import type { z } from 'zod';
import type { ClassSectionEpisode } from '../classTypes';
import styles from './LessonAudioPlayer.module.css';

type Episode = z.infer<typeof episodeDetailResponseSchema>;
type Playback = { turns?: string[]; index: number; serial: number; autoplay: boolean };

/** Replay existing audio assets without generating speech or changing lesson progress. */
export function LessonAudioPlayer({ episode }: { episode: ClassSectionEpisode | null }) {
  return <EpisodeAudioPlayer key={episode?.id ?? 'no-audio'} episode={episode} />;
}

function EpisodeAudioPlayer({ episode }: { episode: ClassSectionEpisode | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const speedRef = useRef(1);
  const [detail, setDetail] = useState<Episode>();
  const [loading, setLoading] = useState(Boolean(episode));
  const [loadError, setLoadError] = useState('');
  const [audioError, setAudioError] = useState('');
  const [reload, setReload] = useState(0);
  const [speaker, setSpeaker] = useState('');
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [playback, setPlayback] = useState<Playback>({ index: 0, serial: 0, autoplay: false });
  const turns = detail?.segments.toSorted((a, b) => a.order - b.order) ?? [];
  const speakers = [...new Set(turns.map((turn) => turn.speaker))];
  const currentTurn = playback.turns
    ? turns.find((turn) => turn.id === playback.turns?.[playback.index])
    : undefined;
  const timelineTurn = !playback.turns
    ? turns.find(
        (turn) =>
          turn.startTime !== null &&
          turn.duration !== null &&
          Number.isFinite(turn.startTime) &&
          Number.isFinite(turn.duration) &&
          turn.startTime >= 0 &&
          turn.duration > 0 &&
          elapsed >= turn.startTime &&
          elapsed < turn.startTime + turn.duration
      )
    : undefined;
  const activeTurn = currentTurn ?? timelineTurn;
  const speakerAvatars = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐰'];
  const fullUrl = detail ? detail.audioUrl : episode?.audioUrl;
  const source = playback.turns ? currentTurn?.audioUrl : fullUrl;
  const status = detail?.status ?? episode?.status;
  const episodeId = episode?.id;
  const unavailable = !episode || status === 'FAILED' || status === 'READY';

  useEffect(() => {
    if (!episodeId) return;
    const requestedId = episodeId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await fetch(`/api/v1/episodes/${encodeURIComponent(requestedId)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Could not load lesson audio and turns.');
        const parsed = episodeDetailResponseSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.id !== requestedId)
          throw new Error('Could not read lesson audio and turns.');
        if (controller.signal.aborted) return;
        setDetail(parsed.data);
        setLoading(false);
        setLoadError('');
        if (parsed.data.status !== 'READY' && parsed.data.status !== 'FAILED')
          timer = setTimeout(() => void load(), 5000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : 'Could not load lesson audio.');
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [episodeId, reload]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;
    audio.pause();
    setElapsed(0);
    audio.defaultPlaybackRate = speedRef.current;
    audio.playbackRate = speedRef.current;
    if (playback.autoplay && source) {
      audio.currentTime = 0;
      void audio.play().catch(() => {
        if (!cancelled) setAudioError('Playback could not start. Try the audio controls again.');
      });
    }
    return () => {
      cancelled = true;
      audio.pause();
    };
  }, [source, playback]);

  useEffect(() => {
    speedRef.current = speed;
    if (audioRef.current) {
      audioRef.current.defaultPlaybackRate = speed;
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  function play(turnIds?: string[]) {
    setAudioError('');
    setPlayback((previous) => ({
      turns: turnIds,
      index: 0,
      serial: previous.serial + 1,
      autoplay: true,
    }));
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !source) return;
    try {
      const end = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      audio.currentTime = Math.max(0, Math.min(end, audio.currentTime + seconds));
    } catch {
      setAudioError('This audio is not ready to seek. Wait for it to load and try again.');
    }
  }

  function reloadAudio() {
    audioRef.current?.pause();
    setAudioError('');
    setLoadError('');
    setLoading(true);
    setPlayback((previous) => ({ index: 0, serial: previous.serial + 1, autoplay: false }));
    setReload((previous) => previous + 1);
  }

  return (
    <section className={styles.root} aria-label="Lesson playback">
      <h2 className={styles.title}>{detail?.title ?? episode?.title ?? 'Lesson audio'}</h2>
      <p className={styles.help}>Listen at your pace. Replay a turn or listen to one speaker.</p>
      <audio
        key={`${source ?? 'no-audio'}:${playback.serial}`}
        ref={audioRef}
        className={styles.audio}
        src={source ?? undefined}
        controls
        preload="metadata"
        aria-label={currentTurn ? `Turn ${turns.indexOf(currentTurn) + 1} audio` : 'Lesson audio'}
        onPlay={() => setAudioError('')}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onError={() =>
          setAudioError('Audio could not be played. Reload audio links and try again.')
        }
        onEnded={() => {
          if (playback.turns && playback.index + 1 < playback.turns.length)
            setPlayback((previous) => ({
              ...previous,
              index: previous.index + 1,
              serial: previous.serial + 1,
            }));
        }}
      />
      <div className={styles.controls}>
        <button type="button" disabled={!source} onClick={() => skip(-10)}>
          Back 10 seconds
        </button>
        <button type="button" disabled={!source} onClick={() => skip(10)}>
          Forward 10 seconds
        </button>
        <label className={styles.speed}>
          Speed
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {[0.5, 0.75, 1, 1.25, 1.5].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        {playback.turns && (
          <button type="button" disabled={!fullUrl} onClick={() => play()}>
            Play full lesson
          </button>
        )}
      </div>
      {currentTurn && (
        <p role="status" className={styles.notice}>
          Selected turn {turns.indexOf(currentTurn) + 1}: {currentTurn.speaker}
          {playback.turns && playback.turns.length > 1
            ? ` (${playback.index + 1} of ${playback.turns.length} selected turns)`
            : ''}
        </p>
      )}
      {!source && (
        <p className={styles.notice} role={unavailable ? 'alert' : 'status'}>
          {unavailable
            ? 'Listening audio is unavailable. Regenerate this class before finishing.'
            : 'Listening audio is generating. You can work on another section while you wait.'}
        </p>
      )}
      {loading && (
        <p className={styles.notice} role="status">
          Loading audio turns…
        </p>
      )}
      {(loadError || audioError) && (
        <div className={styles.error} role="alert">
          <p>{loadError || audioError}</p>
          <button type="button" onClick={reloadAudio}>
            Reload audio links
          </button>
        </div>
      )}
      {detail && turns.length > 0 && (
        <section className={styles.turns} aria-label="Speaker turns">
          <h3 className={styles.turnsTitle}>
            The conversation <span>{turns.length} turns</span>
          </h3>
          <p className={styles.help}>
            Follow who is speaking. Select any turn to play it on its own.
          </p>
          <div className={styles.speakerKey} aria-label="Speakers">
            {speakers.map((name, index) => (
              <span key={name}>
                <span className={styles.avatar} aria-hidden="true">
                  {speakerAvatars[index % speakerAvatars.length]}
                </span>
                {name}
              </span>
            ))}
          </div>
          <div className={styles.speakerControls}>
            <label>
              Speaker
              <select value={speaker} onChange={(event) => setSpeaker(event.target.value)}>
                <option value="">Choose a speaker</option>
                {speakers.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!turns.some((turn) => turn.speaker === speaker && turn.audioUrl)}
              onClick={() =>
                play(
                  turns
                    .filter((turn) => turn.speaker === speaker && turn.audioUrl)
                    .map((turn) => turn.id)
                )
              }
            >
              Play this speaker
            </button>
          </div>
          {turns.some((turn) => !turn.audioUrl) && (
            <p className={styles.notice}>
              Some turns have no audio yet. Speaker playback includes available turns.
            </p>
          )}
          <ol className={styles.turnList}>
            {turns.map((turn, index) => (
              <li key={turn.id} aria-current={activeTurn?.id === turn.id ? 'true' : undefined}>
                <span className={styles.avatar} aria-hidden="true">
                  {speakerAvatars[speakers.indexOf(turn.speaker) % speakerAvatars.length]}
                </span>
                <div className={styles.turnBody}>
                  <div className={styles.turnHeading}>
                    <strong>{turn.speaker}</strong>
                    <span>Turn {index + 1}</span>
                    {activeTurn?.id === turn.id && (
                      <span className={styles.currentLabel}>Current turn</span>
                    )}
                  </div>
                  <p>{turn.text}</p>
                  {!turn.audioUrl && <span className={styles.notice}>Turn audio unavailable</span>}
                </div>
                <button
                  type="button"
                  disabled={!turn.audioUrl}
                  aria-label={`Play turn ${index + 1}: ${turn.speaker}`}
                  onClick={() => play([turn.id])}
                >
                  <span aria-hidden="true">▶</span> Replay
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {detail && turns.length === 0 && (
        <p className={styles.notice}>
          Separate turns are unavailable for this recording. Use the full lesson controls.
        </p>
      )}
    </section>
  );
}
