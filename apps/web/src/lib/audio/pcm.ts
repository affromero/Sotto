// Pure PCM helpers for the Gemini Live audio pipeline. The browser sends mic audio
// as 16 kHz mono Int16 PCM (base64) and receives 24 kHz mono Int16 PCM back. These
// functions are the single tested source of truth for the resample/encode/decode
// math; the AudioWorklets stay dumb forwarders and call into these from the main
// thread. No DOM or audio APIs here, so they unit-test cleanly.

/** Gemini Live expects mic input at 16 kHz mono. */
export const LIVE_INPUT_SAMPLE_RATE = 16000;
/** Gemini Live returns audio at 24 kHz mono. */
export const LIVE_OUTPUT_SAMPLE_RATE = 24000;

/** Linear-resample a Float32 mono buffer from srcRate to dstRate. */
export function resampleFloat32(input: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || input.length === 0) return input;
  const ratio = srcRate / dstRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Clamp Float32 [-1, 1] samples and convert to Int16 PCM. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Convert Int16 PCM samples back to Float32 [-1, 1] for playback. */
export function int16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/** Capture pipeline: resample mic float32 to 16 kHz then encode to Int16 PCM. */
export function encodeForCapture(input: Float32Array, srcRate: number): Int16Array {
  return floatToInt16(resampleFloat32(input, srcRate, LIVE_INPUT_SAMPLE_RATE));
}

/** Base64-encode an Int16Array's little-endian bytes for the Live realtime blob. */
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode a base64 PCM blob into Int16 samples (drops a trailing odd byte). */
export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  // Copy into an aligned buffer so the Int16 view is always valid.
  const aligned = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < sampleCount; i++) aligned[i] = view.getInt16(i * 2, true);
  return aligned;
}

/** Root-mean-square loudness of a Float32 frame, 0..1 (for a mic level meter). */
export function frameLevel(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  return Math.min(1, Math.sqrt(sum / input.length));
}
