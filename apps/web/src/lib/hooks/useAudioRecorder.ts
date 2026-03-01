import { useState, useRef, useCallback } from 'react';

interface UseAudioRecorderOptions {
  maxSeconds?: number;
  minSeconds?: number;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  recordedBlob: Blob | null;
  duration: number;
  mimeType: string | null;
  error: string | null;
  minSeconds: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  playPreview: () => void;
  reset: () => void;
}

export function useAudioRecorder(
  opts?: UseAudioRecorderOptions
): UseAudioRecorderReturn {
  const maxSeconds = opts?.maxSeconds ?? 60;
  const minSeconds = opts?.minSeconds ?? 5;

  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mime });
        setRecordedBlob(blob);
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      };

      mediaRecorder.current = recorder;
      setMimeType(mime);
      recorder.start();
      setIsRecording(true);
      setDuration(0);
      setError(null);
      setRecordedBlob(null);

      timerRef.current = setInterval(() => {
        setDuration((t) => {
          if (t >= maxSeconds - 1) {
            recorder.stop();
            return maxSeconds;
          }
          return t + 1;
        });
      }, 1000);
    } catch {
      setError(
        'Microphone access denied. Please allow microphone access and try again.'
      );
    }
  }, [maxSeconds]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  const playPreview = useCallback(() => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    audioRef.current = new Audio(url);
    audioRef.current.play();
    audioRef.current.onended = () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  const reset = useCallback(() => {
    setRecordedBlob(null);
    setDuration(0);
    setIsRecording(false);
    setError(null);
    setMimeType(null);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  return {
    isRecording,
    recordedBlob,
    duration,
    mimeType,
    error,
    startRecording,
    stopRecording,
    playPreview,
    reset,
    minSeconds,
  };
}
