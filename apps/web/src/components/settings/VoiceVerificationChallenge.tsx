'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './VoiceVerificationChallenge.module.css';
import { useAudioRecorder } from '@/lib/hooks/useAudioRecorder';

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorder = useAudioRecorder({ maxSeconds: 30, minSeconds: 5 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/voices/verify?voiceCloneId=${voiceCloneId}`);
        if (cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.challenge) {
          setChallenge(data.challenge);
          setStatus('ready');
        } else {
          setError('No active challenge found');
        }
      } catch {
        if (!cancelled) setError('Failed to load challenge');
      }
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [voiceCloneId]);

  async function handleStartRecording() {
    setError(null);
    setStatus('recording');
    await recorder.startRecording();
    if (recorder.error) {
      setStatus('ready');
    }
  }

  function handleStopRecording() {
    recorder.stopRecording();
    setStatus('recorded');
  }

  async function submitRecording() {
    if (!recorder.recordedBlob) return;
    setStatus('submitting');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('voiceCloneId', voiceCloneId);
      formData.append('audio', recorder.recordedBlob, 'challenge.webm');

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
          recorder.reset();
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
    recorder.reset();
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
                  onClick={handleStartRecording}
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
                    Recording... {recorder.duration}s
                    {recorder.duration < recorder.minSeconds && (
                      <span className={styles.minHint}>(min {recorder.minSeconds}s)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.stopBtn}
                    onClick={handleStopRecording}
                    disabled={recorder.duration < recorder.minSeconds}
                  >
                    Stop
                  </button>
                </div>
              )}

              {status === 'recorded' && (
                <div className={styles.recordedActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={recorder.playPreview}>
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
