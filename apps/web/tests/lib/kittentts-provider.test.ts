import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelectKittenVoicePair } = vi.hoisted(() => ({
  mockSelectKittenVoicePair: vi.fn().mockReturnValue({ host: 'rosie', expert: 'hugo' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/providers/tts-registry', () => ({
  getProviderMeta: vi.fn(),
  compareQuality: vi.fn(),
}));

vi.mock('@/lib/voice-pool', () => ({
  VOICE_POOL: [],
  selectVoicePair: vi.fn(),
  resolveVoiceId: vi.fn(),
  findByVoiceId: vi.fn(),
  scoreToneMatch: vi.fn().mockReturnValue(0),
  selectKittenVoicePair: mockSelectKittenVoicePair,
}));

vi.mock('@/lib/byok', () => ({
  getByokKey: vi.fn(),
  getByokExtraData: vi.fn(),
  listByokProviders: vi.fn().mockResolvedValue([]),
  hasByokKey: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/free-tier-config', () => ({
  getFreeTierConfig: vi.fn().mockResolvedValue({ ttsProvider: 'openai', ttsModel: 'tts-1-hd' }),
}));

// Mock child_process.spawn to avoid needing real FFmpeg
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mockMp3Bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

  const mocked = {
    ...actual,
    spawn: vi.fn().mockImplementation(() => {
      const { EventEmitter } = require('events');
      const { Readable, Writable } = require('stream');

      const proc = new EventEmitter();
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.stdin = new Writable({
        write(_chunk: unknown, _enc: string, cb: () => void) { cb(); },
        final(cb: () => void) {
          proc.stdout.push(mockMp3Bytes);
          proc.stdout.push(null);
          setTimeout(() => proc.emit('close', 0), 0);
          cb();
        },
      });

      return proc;
    }),
  };

  return { ...mocked, default: mocked };
});

import { KittenTtsProvider } from '@/lib/providers/tts/kittentts.provider';

const mockWavBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]);

describe('KittenTtsProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSelectKittenVoicePair.mockReturnValue({ host: 'rosie', expert: 'hugo' });
  });

  it('sends a POST to /synthesize and returns audio buffer', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockWavBytes.buffer,
    });
    global.fetch = fetchMock;

    const provider = new KittenTtsProvider();
    const result = await provider.generateSpeech({ text: 'Hello world', voiceId: 'jasper' });

    expect(result).toBeInstanceOf(Buffer);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://kittentts:8000/synthesize');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(opts.body);
    expect(body.get('text')).toBe('Hello world');
    expect(body.get('voice')).toBe('jasper');
  });

  it('uses KITTENTTS_URL env var when set', async () => {
    process.env.KITTENTTS_URL = 'http://localhost:9000';

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockWavBytes.buffer,
    });
    global.fetch = fetchMock;

    const provider = new KittenTtsProvider();
    await provider.generateSpeech({ text: 'Test', voiceId: 'bella' });

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:9000/synthesize');

    delete process.env.KITTENTTS_URL;
  });

  it('throws on HTTP error from sidecar', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Model not loaded',
    });

    const provider = new KittenTtsProvider();
    await expect(
      provider.generateSpeech({ text: 'Test', voiceId: 'jasper' })
    ).rejects.toThrow('KittenTTS synthesis failed (503): Model not loaded');
  });

  it('returns default voices when no podcastId is provided', () => {
    const provider = new KittenTtsProvider();
    expect(provider.getVoiceId('HOST')).toBe('bella');
    expect(provider.getVoiceId('EXPERT')).toBe('jasper');
  });

  it('returns deterministic voices from voice pool for a given podcastId', () => {
    const provider = new KittenTtsProvider();

    expect(provider.getVoiceId('HOST', 'pod-abc')).toBe('rosie');
    expect(provider.getVoiceId('EXPERT', 'pod-abc')).toBe('hugo');

    expect(mockSelectKittenVoicePair).toHaveBeenCalledWith('pod-abc');
  });

  it('reports correct model ID and provider ID', () => {
    const provider = new KittenTtsProvider();
    expect(provider.getModelId()).toBe('kitten-tts-mini-0.8');
    expect(provider.providerId).toBe('kittentts');
  });

  it('falls back to raw WAV when FFmpeg conversion fails', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockImplementationOnce(() => {
      const { EventEmitter } = require('events');
      const { Readable, Writable } = require('stream');

      const proc = new EventEmitter();
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.stdin = new Writable({
        write(_chunk: unknown, _enc: string, cb: () => void) { cb(); },
        final(cb: () => void) {
          proc.stdout.push(null);
          setTimeout(() => proc.emit('close', 1), 0);
          cb();
        },
      });

      return proc as ReturnType<typeof spawn>;
    });

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => mockWavBytes.buffer,
    });
    global.fetch = fetchMock;

    const provider = new KittenTtsProvider();
    const result = await provider.generateSpeech({ text: 'Test', voiceId: 'bella' });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(mockWavBytes.length);
  });

  it('propagates network errors from fetch', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const provider = new KittenTtsProvider();
    await expect(
      provider.generateSpeech({ text: 'Test', voiceId: 'jasper' })
    ).rejects.toThrow('ECONNREFUSED');
  });
});
