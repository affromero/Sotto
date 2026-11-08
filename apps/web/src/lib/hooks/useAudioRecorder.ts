import { useState, useRef, useCallback, useEffect } from 'react';

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
  startRecording: (canStart?: () => boolean) => Promise<void>;
  stopRecording: () => void;
  playPreview: () => void;
  reset: () => void;
}

export function useAudioRecorder(opts?: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const maxSeconds = opts?.maxSeconds ?? 60;
  const minSeconds = opts?.minSeconds ?? 5;

  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      audioRef.current?.pause();
    };
  }, []);

  const startRecording = useCallback(
    async (canStart?: () => boolean) => {
      if (mediaRecorder.current?.state === 'recording') return;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      const operation = ++generation.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted.current || generation.current !== operation || (canStart && !canStart())) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/mp4';

        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const chunks: Blob[] = [];
        let timer: ReturnType<typeof setInterval> | null = null;

        recorder.ondataavailable = (e) => {
          if (mounted.current && generation.current === operation && e.data.size > 0)
            chunks.push(e.data);
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (streamRef.current === stream) streamRef.current = null;
          if (timer) clearInterval(timer);
          if (timerRef.current === timer) timerRef.current = null;
          if (!mounted.current || generation.current !== operation) return;
          const blob = new Blob(chunks, { type: mime });
          setRecordedBlob(blob);
          setIsRecording(false);
        };

        mediaRecorder.current = recorder;
        setMimeType(mime);
        recorder.start();
        setIsRecording(true);
        setDuration(0);
        setError(null);
        setRecordedBlob(null);

        let elapsed = 0;
        timer = setInterval(() => {
          if (
            !mounted.current ||
            generation.current !== operation ||
            recorder.state !== 'recording'
          ) {
            if (timer) clearInterval(timer);
            if (timerRef.current === timer) timerRef.current = null;
            return;
          }
          elapsed += 1;
          setDuration(elapsed);
          if (elapsed >= maxSeconds) {
            if (timer) clearInterval(timer);
            if (timerRef.current === timer) timerRef.current = null;
            recorder.stop();
          }
        }, 1000);
        timerRef.current = timer;
      } catch {
        if (!mounted.current || generation.current !== operation) return;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setError('Microphone access denied. Please allow microphone access and try again.');
      }
    },
    [maxSeconds]
  );

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
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
    generation.current += 1;
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
