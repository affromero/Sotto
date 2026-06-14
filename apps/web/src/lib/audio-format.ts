export interface AudioFormat {
  /** File extension without a leading dot, e.g. `wav`. */
  ext: string;
  /** MIME type, e.g. `audio/wav`. */
  mime: string;
}

/**
 * Detect an audio container from its leading magic bytes.
 *
 * Upload sources differ: the browser's MediaRecorder emits WebM/Opus, while the
 * `sotto` terminal client uploads WAV. STT providers need a correct filename +
 * MIME or they mislabel the bytes (historically everything was sent as
 * `audio.mp3` / `audio/mpeg`, which OpenAI Whisper tolerates by sniffing but a
 * local Whisper server receiving `octet-stream` does not). We derive the format
 * from the actual audio rather than trusting a client-supplied content-type or a
 * stored extension, so it is always honest end to end.
 *
 * Falls back to mp3 for unrecognized input (the prior behavior), which keeps
 * byte-sniffing providers working.
 */
/**
 * Match the leading magic bytes against a known audio container and return its
 * format, or `null` when nothing is recognized. This is the single source of
 * truth shared by {@link detectAudioFormat} and {@link isRecognizedAudio}.
 */
function matchAudioFormat(buffer: Buffer): AudioFormat | null {
  // RIFF....WAVE (WAV)
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return { ext: 'wav', mime: 'audio/wav' };
  }

  // EBML header 1A 45 DF A3 (WebM / Matroska)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { ext: 'webm', mime: 'audio/webm' };
  }

  // "OggS" (Ogg / Opus)
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') {
    return { ext: 'ogg', mime: 'audio/ogg' };
  }

  // "fLaC" (FLAC)
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC') {
    return { ext: 'flac', mime: 'audio/flac' };
  }

  // ISO-BMFF: bytes 4..8 == "ftyp" (MP4 / M4A)
  if (buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { ext: 'm4a', mime: 'audio/mp4' };
  }

  // "ID3" tag or MPEG-audio frame sync (0xFF followed by 0b111xxxxx)
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }

  return null;
}

export function detectAudioFormat(buffer: Buffer): AudioFormat {
  return matchAudioFormat(buffer) ?? { ext: 'mp3', mime: 'audio/mpeg' };
}

/**
 * Whether the buffer's leading bytes match a known audio container (WAV, WebM,
 * Ogg, FLAC, MP4/M4A, or MP3). Unlike {@link detectAudioFormat}, this does NOT
 * fall back to mp3, so zero-byte, too-small, or random-byte uploads return
 * false. Use it to reject empty/garbage audio before storing or grading it.
 */
export function isRecognizedAudio(buffer: Buffer): boolean {
  return matchAudioFormat(buffer) !== null;
}
