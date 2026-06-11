'use client';

// Drives the browser audio for a Gemini Live session: captures the mic as 16 kHz
// Int16 PCM (base64) frames via an AudioWorklet, and plays back incoming 24 kHz
// Int16 PCM through a second worklet with a small jitter buffer. The PCM math
// lives in the tested lib/audio/pcm.ts; this hook only wires audio nodes and
// handles permission + autoplay states. start() must be called from a user
// gesture so the AudioContexts can resume.
import { useCallback, useRef, useState } from 'react';
import {
  encodeForCapture,
  int16ToBase64,
  base64ToInt16,
  int16ToFloat32,
  frameLevel,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
} from '@/lib/audio/pcm';

const CAPTURE_WORKLET_URL = '/worklets/pcm-capture.worklet.js';
const PLAYBACK_WORKLET_URL = '/worklets/pcm-playback.worklet.js';

export type LiveAudioStatus = 'idle' | 'running' | 'denied' | 'unsupported' | 'error';

export interface UseLiveAudio {
  status: LiveAudioStatus;
  error: string | null;
  /** 0..1 RMS loudness of the most recent mic frame, for a level meter. */
  inputLevel: number;
  start: (onFrame: (base64Pcm16k: string) => void) => Promise<void>;
  enqueue: (base64Pcm24k: string) => void;
  flush: () => void;
  stop: () => void;
}

function audioWorkletSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
}

export function useLiveAudio(): UseLiveAudio {
  const [status, setStatus] = useState<LiveAudioStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);

  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    playbackNodeRef.current?.port.postMessage('flush');
    playbackNodeRef.current = null;
    captureCtxRef.current?.close().catch(() => undefined);
    playbackCtxRef.current?.close().catch(() => undefined);
    captureCtxRef.current = null;
    playbackCtxRef.current = null;
    setInputLevel(0);
    setStatus('idle');
  }, []);

  const start = useCallback(async (onFrame: (base64Pcm16k: string) => void) => {
    setError(null);
    if (!audioWorkletSupported()) {
      setStatus('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // Capture: request 16 kHz; still resample defensively for browsers that ignore it.
      const captureCtx = new AudioContext({ sampleRate: LIVE_INPUT_SAMPLE_RATE });
      captureCtxRef.current = captureCtx;
      await captureCtx.audioWorklet.addModule(CAPTURE_WORKLET_URL);
      await captureCtx.resume();
      const source = captureCtx.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(captureCtx, 'pcm-capture', { numberOfOutputs: 0 });
      captureNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const f32 = e.data;
        setInputLevel(frameLevel(f32));
        onFrame(int16ToBase64(encodeForCapture(f32, captureCtx.sampleRate)));
      };
      source.connect(captureNode);

      // Playback: 24 kHz context so incoming frames play without resampling.
      const playbackCtx = new AudioContext({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE });
      playbackCtxRef.current = playbackCtx;
      await playbackCtx.audioWorklet.addModule(PLAYBACK_WORKLET_URL);
      await playbackCtx.resume();
      const playbackNode = new AudioWorkletNode(playbackCtx, 'pcm-playback', { numberOfInputs: 0 });
      playbackNode.connect(playbackCtx.destination);
      playbackNodeRef.current = playbackNode;

      setStatus('running');
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  const enqueue = useCallback((base64Pcm24k: string) => {
    const node = playbackNodeRef.current;
    if (!node) return;
    const f32 = int16ToFloat32(base64ToInt16(base64Pcm24k));
    node.port.postMessage(f32, [f32.buffer]);
  }, []);

  const flush = useCallback(() => {
    playbackNodeRef.current?.port.postMessage('flush');
  }, []);

  return { status, error, inputLevel, start, enqueue, flush, stop };
}
