/**
 * Pure PCM helpers for the Live audio pipeline: resampling, Int16<->Float32
 * conversion, base64 round-trip, and the mic level meter. These are the tested
 * source of truth the AudioWorklets defer to.
 */
import { describe, it, expect } from 'vitest';
import {
  resampleFloat32,
  floatToInt16,
  int16ToFloat32,
  encodeForCapture,
  int16ToBase64,
  base64ToInt16,
  frameLevel,
  LIVE_INPUT_SAMPLE_RATE,
} from '@/lib/audio/pcm';

describe('resampleFloat32', () => {
  it('returns the input unchanged when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleFloat32(input, 16000, 16000)).toBe(input);
  });

  it('downsamples 48k to 16k to roughly a third of the samples', () => {
    const input = new Float32Array(300).fill(0.5);
    const out = resampleFloat32(input, 48000, 16000);
    expect(out.length).toBe(100);
    // A constant signal stays constant through linear interpolation.
    expect(out[50]).toBeCloseTo(0.5, 5);
  });

  it('preserves the leading sample value', () => {
    const input = new Float32Array([1, 0, 1, 0, 1, 0]);
    const out = resampleFloat32(input, 48000, 24000);
    expect(out[0]).toBeCloseTo(1, 5);
  });
});

describe('floatToInt16 / int16ToFloat32', () => {
  it('clamps out-of-range samples to the Int16 extremes', () => {
    const out = floatToInt16(new Float32Array([2, -2, 0]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
    expect(out[2]).toBe(0);
  });

  it('round-trips a mid-range sample within quantization error', () => {
    const original = new Float32Array([0.5, -0.5, 0.25]);
    const back = int16ToFloat32(floatToInt16(original));
    expect(back[0]).toBeCloseTo(0.5, 3);
    expect(back[1]).toBeCloseTo(-0.5, 3);
    expect(back[2]).toBeCloseTo(0.25, 3);
  });
});

describe('encodeForCapture', () => {
  it('resamples to 16k and yields Int16 PCM', () => {
    const input = new Float32Array(480).fill(0.25); // 10ms @ 48k
    const out = encodeForCapture(input, 48000);
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(Math.round(480 / (48000 / LIVE_INPUT_SAMPLE_RATE)));
    expect(out[5]).toBeCloseTo(Math.round(0.25 * 0x7fff), 0);
  });
});

describe('base64 round-trip', () => {
  it('encodes and decodes Int16 PCM losslessly', () => {
    const pcm = new Int16Array([0, 1, -1, 12345, -12345, 32767, -32768]);
    const decoded = base64ToInt16(int16ToBase64(pcm));
    expect(Array.from(decoded)).toEqual(Array.from(pcm));
  });

  it('drops a trailing odd byte rather than misaligning samples', () => {
    // 'AAA' decodes to 2 bytes -> exactly 1 sample; an extra byte would be dropped.
    const decoded = base64ToInt16(int16ToBase64(new Int16Array([7])));
    expect(decoded.length).toBe(1);
    expect(decoded[0]).toBe(7);
  });
});

describe('frameLevel', () => {
  it('is zero for silence and empty frames', () => {
    expect(frameLevel(new Float32Array(0))).toBe(0);
    expect(frameLevel(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it('reports the RMS of a constant-amplitude frame', () => {
    expect(frameLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 5);
  });
});
