import { describe, it, expect } from 'vitest';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';

function withHeader(...parts: Array<string | number[]>): Buffer {
  const chunks = parts.map((p) =>
    typeof p === 'string' ? Buffer.from(p, 'ascii') : Buffer.from(p)
  );
  // Pad so length checks that need >= 12 bytes always pass.
  return Buffer.concat([...chunks, Buffer.alloc(16)]);
}

describe('detectAudioFormat', () => {
  it('detects WAV from RIFF/WAVE header', () => {
    const buf = withHeader('RIFF', [0, 0, 0, 0], 'WAVE');
    expect(detectAudioFormat(buf)).toEqual({ ext: 'wav', mime: 'audio/wav' });
  });

  it('detects WebM from the EBML magic bytes', () => {
    const buf = withHeader([0x1a, 0x45, 0xdf, 0xa3]);
    expect(detectAudioFormat(buf)).toEqual({ ext: 'webm', mime: 'audio/webm' });
  });

  it('detects Ogg from the OggS header', () => {
    expect(detectAudioFormat(withHeader('OggS'))).toEqual({ ext: 'ogg', mime: 'audio/ogg' });
  });

  it('detects FLAC from the fLaC header', () => {
    expect(detectAudioFormat(withHeader('fLaC'))).toEqual({ ext: 'flac', mime: 'audio/flac' });
  });

  it('detects MP4/M4A from the ftyp box', () => {
    const buf = withHeader([0, 0, 0, 0x20], 'ftyp');
    expect(detectAudioFormat(buf)).toEqual({ ext: 'm4a', mime: 'audio/mp4' });
  });

  it('detects MP3 from an ID3 tag', () => {
    expect(detectAudioFormat(withHeader('ID3'))).toEqual({ ext: 'mp3', mime: 'audio/mpeg' });
  });

  it('detects MP3 from an MPEG frame sync', () => {
    expect(detectAudioFormat(withHeader([0xff, 0xfb]))).toEqual({ ext: 'mp3', mime: 'audio/mpeg' });
  });

  it('falls back to mp3 for unrecognized input', () => {
    expect(detectAudioFormat(withHeader([0x00, 0x01, 0x02, 0x03]))).toEqual({
      ext: 'mp3',
      mime: 'audio/mpeg',
    });
  });
});

describe('isRecognizedAudio', () => {
  it('returns true for a minimal RIFF/WAVE header', () => {
    expect(isRecognizedAudio(withHeader('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe(true);
  });

  it('returns true for an EBML/WebM header', () => {
    expect(isRecognizedAudio(withHeader([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
  });

  it('returns true for an OggS header', () => {
    expect(isRecognizedAudio(withHeader('OggS'))).toBe(true);
  });

  it('returns true for a fLaC header', () => {
    expect(isRecognizedAudio(withHeader('fLaC'))).toBe(true);
  });

  it('returns true for an ftyp (MP4/M4A) box', () => {
    expect(isRecognizedAudio(withHeader([0, 0, 0, 0x20], 'ftyp'))).toBe(true);
  });

  it('returns true for an ID3 tag', () => {
    expect(isRecognizedAudio(withHeader('ID3'))).toBe(true);
  });

  it('returns false for a zero-byte buffer', () => {
    expect(isRecognizedAudio(Buffer.alloc(0))).toBe(false);
  });

  it('returns false for a too-small (3-byte) garbage buffer', () => {
    expect(isRecognizedAudio(Buffer.from([0x00, 0x01, 0x02]))).toBe(false);
  });

  it('returns false for random bytes that match no container', () => {
    expect(isRecognizedAudio(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]))).toBe(
      false
    );
  });

  it('detectAudioFormat still falls back to mp3 for the same garbage isRecognizedAudio rejects', () => {
    const garbage = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
    expect(isRecognizedAudio(garbage)).toBe(false);
    expect(detectAudioFormat(garbage)).toEqual({ ext: 'mp3', mime: 'audio/mpeg' });
  });
});
