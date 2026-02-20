'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './VoiceVerificationChallenge.module.css';

interface VoiceVerificationChallengeProps {
  voiceCloneId: string;
  voiceName: string;
  onVerified: () => void;
  onClose: () => void;
}

interface Challenge {
  id: string;
  phrase: string;
  attemptNumber: number;
  expiresAt: string;
}

type Status = 'loading' | 'ready' | 'recording' | 'recorded' | 'submitting' | 'polling';

export function VoiceVerificationChallenge({
  voiceCloneId,
  voiceName,
  onVerified,
  onClose,
}: VoiceVerificationChallengeProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchChallenge = useCallback(async () => {
    try {
      const res = await fetch(`/api/voices/verify?voiceCloneId=${voiceCloneId}`);
      const data = await res.json();
      if (data.challenge) {
        setChallenge(data.challenge);
        setStatus('ready');
      } else {
        setError('No active challenge found');
      }
    } catch {
      setError('Failed to load challenge');
    }
  }, [voiceCloneId]);

  useEffect(() => {
    fetchChallenge();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchChallenge]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mimeType });
        setRecordedBlob(blob);
        setStatus('recorded');
        if (timerRef.current) clearInterval(timerRef.current);
      };

      mediaRecorder.current = recorder;
      recorder.start();
      setStatus('recording');
      setRecordingTime(0);
      setError(null);

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => {
          if (t >= 29) {
            recorder.stop();
            return 30;
          }
          return t + 1;
        });
      }, 1000);
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.');
    }
  }

  function stopRecording() {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }

  function playPreview() {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    audioRef.current = new Audio(url);
    audioRef.current.play();
    audioRef.current.onended = () => URL.revokeObjectURL(url);
  }

  async function submitRecording() {
    if (!recordedBlob) return;
    setStatus('submitting');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('voiceCloneId', voiceCloneId);
      formData.append('audio', recordedBlob, 'challenge.webm');

      const res = await fetch('/api/voices/verify', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to submit recording');
        setStatus('recorded');
        return;
      }

      // Poll for result
      setStatus('polling');
      pollRef.current = setInterval(async () => {
        const pollRes = await fetch(`/api/voices/verify?voiceCloneId=${voiceCloneId}`);
        const pollData = await pollRes.json();

        // Re-fetch the voice clone status
        const voiceRes = await fetch('/api/voices');
        const voiceData = await voiceRes.json();
        const voice = voiceData.userClones?.find(
          (v: { id: string; verificationStatus: string }) => v.id === voiceCloneId
        );

        if (!voice) return;

        if (voice.verificationStatus === 'VERIFIED') {
          if (pollRef.current) clearInterval(pollRef.current);
          onVerified();
        } else if (voice.verificationStatus === 'AWAITING_CHALLENGE') {
          // Failed but has retries — reload challenge
          if (pollRef.current) clearInterval(pollRef.current);
          setRecordedBlob(null);
          if (pollData.challenge) {
            setChallenge(pollData.challenge);
            setStatus('ready');
            setError(
              `Verification failed. Please try again (attempt ${pollData.challenge.attemptNumber} of 3).`
            );
          }
        } else if (voice.verificationStatus === 'REJECTED') {
          if (pollRef.current) clearInterval(pollRef.current);
          setError('Voice verification failed after 3 attempts. The voice clone has been removed.');
          setStatus('ready');
        }
      }, 2000);
    } catch {
      setError('Failed to submit recording');
      setStatus('recorded');
    }
  }

  function resetRecording() {
    setRecordedBlob(null);
    setRecordingTime(0);
    setStatus('ready');
  }

  const isExpired = challenge ? new Date() > new Date(challenge.expiresAt) : false;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          &times;
        </button>

        <h3 className={styles.title}>Verify Your Voice</h3>
        <p className={styles.subtitle}>
          Prove that <strong>{voiceName}</strong> is your voice by reading the phrase below aloud.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        {status === 'loading' && (
          <div className={styles.loadingState}>
            <span className={styles.spinner} />
            Loading challenge...
          </div>
        )}

        {challenge && status !== 'loading' && (
          <>
            <div className={styles.phraseCard}>
              <div className={styles.phraseLabel}>Read this aloud:</div>
              <p className={styles.phrase}>&ldquo;{challenge.phrase}&rdquo;</p>
              {challenge.attemptNumber > 1 && (
                <div className={styles.attemptBadge}>
                  Attempt {challenge.attemptNumber} of 3
                </div>
              )}
            </div>

            <div className={styles.controls}>
              {status === 'ready' && !isExpired && (
                <button
                  type="button"
                  className={styles.recordBtn}
                  onClick={startRecording}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <circle cx="10" cy="10" r="6" />
                  </svg>
                  Start Recording
                </button>
              )}

              {isExpired && status === 'ready' && (
                <div className={styles.expiredMsg}>
                  Challenge expired. Please close and request a new one.
                </div>
              )}

              {status === 'recording' && (
                <div className={styles.recordingState}>
                  <div className={styles.recordingIndicator}>
                    <span className={styles.recordingDot} />
                    Recording... {recordingTime}s
                    {recordingTime < 5 && (
                      <span className={styles.minHint}>(min 5s)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.stopBtn}
                    onClick={stopRecording}
                    disabled={recordingTime < 5}
                  >
                    Stop
                  </button>
                </div>
              )}

              {status === 'recorded' && (
                <div className={styles.recordedActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={playPreview}>
                    Play Preview
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={resetRecording}>
                    Re-record
                  </button>
                  <button type="button" className={styles.submitBtn} onClick={submitRecording}>
                    Submit for Verification
                  </button>
                </div>
              )}

              {(status === 'submitting' || status === 'polling') && (
                <div className={styles.loadingState}>
                  <span className={styles.spinner} />
                  {status === 'submitting' ? 'Uploading...' : 'Verifying your voice...'}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
