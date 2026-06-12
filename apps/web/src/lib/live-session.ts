'use client';

// Opens a Gemini Live session from the browser using the ephemeral token minted by
// /api/v1/live-translate/token. The BYOK key never reaches here. Outgoing mic frames
// (16 kHz Int16 base64) go in via sendAudio; incoming translated audio (24 kHz) and
// the input/output transcriptions surface through callbacks. The caller wires these
// to useLiveAudio (frames out, audio enqueue) and the UI captions.
import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session,
} from '@google/genai';

export interface LiveTokenPayload {
  token: string;
  model: string;
  apiVersion: string;
  targetLanguageCode: string;
  nativeLanguageCode: string;
  direction: 'native_to_target' | 'target_to_native';
  expiresAt: string;
}

export interface LiveSessionCallbacks {
  /** Base64 24 kHz Int16 PCM produced by the model (play it back). */
  onAudio: (base64Pcm24k: string) => void;
  /** Transcription of what the learner said. */
  onInputTranscript: (text: string, finished: boolean) => void;
  /** Transcription of the translated audio (the caption). */
  onOutputTranscript: (text: string, finished: boolean) => void;
  /** The model was interrupted; the client should drop its playback queue. */
  onInterrupted?: () => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onError?: (message: string) => void;
}

export interface LiveSessionHandle {
  sendAudio: (base64Pcm16k: string) => void;
  close: () => void;
}

export async function openLiveSession(
  payload: LiveTokenPayload,
  callbacks: LiveSessionCallbacks,
): Promise<LiveSessionHandle> {
  const ai = new GoogleGenAI({
    apiKey: payload.token,
    httpOptions: { apiVersion: payload.apiVersion },
  });

  const session: Session = await ai.live.connect({
    model: payload.model,
    // Educational translation aid, NOT a conversational agent. translationConfig
    // puts the model in pure translation mode: it only ever speaks back the translation
    // of the learner's audio. We deliberately do not enable enableAffectiveDialog or any
    // proactivity, so the model has no agenda of its own and never chats or interrupts.
    config: {
      responseModalities: [Modality.AUDIO],
      translationConfig: { targetLanguageCode: payload.targetLanguageCode },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => callbacks.onOpen?.(),
      onmessage: (message: LiveServerMessage) => {
        const content = message.serverContent;
        if (!content) return;
        if (content.interrupted) callbacks.onInterrupted?.();
        for (const part of content.modelTurn?.parts ?? []) {
          const data = part.inlineData?.data;
          if (data) callbacks.onAudio(data);
        }
        const input = content.inputTranscription;
        if (input?.text) callbacks.onInputTranscript(input.text, input.finished ?? false);
        const output = content.outputTranscription;
        if (output?.text) callbacks.onOutputTranscript(output.text, output.finished ?? false);
      },
      onerror: (e: ErrorEvent) => callbacks.onError?.(e.message || 'Live session error'),
      onclose: (e: CloseEvent) => callbacks.onClose?.(e.reason || 'closed'),
    },
  });

  return {
    sendAudio: (base64Pcm16k: string) => {
      session.sendRealtimeInput({
        audio: { data: base64Pcm16k, mimeType: 'audio/pcm;rate=16000' },
      });
    },
    close: () => session.close(),
  };
}
