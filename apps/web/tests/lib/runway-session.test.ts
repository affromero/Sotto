import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Hoisted mocks (must use vi.hoisted so they're available inside vi.mock factories) ---

const {
  mockExecFileAsync,
  mockRoomOn,
  mockRoomConnect,
  mockRoomDisconnect,
  mockPublishTrack,
  mockCaptureFrame,
  mockWaitForPlayout,
  mockCreateAudioTrack,
  mockVideoStreamReader,
  mockSpawn,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockRoomOn: vi.fn(),
  mockRoomConnect: vi.fn(),
  mockRoomDisconnect: vi.fn(),
  mockPublishTrack: vi.fn(),
  mockCaptureFrame: vi.fn(),
  mockWaitForPlayout: vi.fn(),
  mockCreateAudioTrack: vi.fn(),
  mockVideoStreamReader: vi.fn(),
  mockSpawn: vi.fn(),
}));

// --- Module mocks ---

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('util', () => ({
  default: { promisify: () => mockExecFileAsync },
  promisify: () => mockExecFileAsync,
}));

vi.mock('child_process', () => {
  const spawnFn = (...args: unknown[]) => mockSpawn(...args);
  const execFileFn = vi.fn();
  // Vitest 4.x resolves named CJS imports from `default` for CJS modules
  return {
    default: { spawn: spawnFn, execFile: execFileFn },
    spawn: spawnFn,
    execFile: execFileFn,
  };
});

vi.mock('@livekit/rtc-node', () => {
  class FakeRemoteVideoTrack {}

  return {
    Room: class {
      on = mockRoomOn;
      connect = mockRoomConnect;
      disconnect = mockRoomDisconnect;
      localParticipant = { publishTrack: mockPublishTrack };
    },
    RoomEvent: {
      TrackPublished: 'TrackPublished',
      TrackSubscribed: 'TrackSubscribed',
      TrackUnsubscribed: 'TrackUnsubscribed',
    },
    RemoteVideoTrack: FakeRemoteVideoTrack,
    VideoStream: class {
      getReader() {
        return { read: mockVideoStreamReader };
      }
    },
    AudioSource: class {
      captureFrame = mockCaptureFrame;
      waitForPlayout = mockWaitForPlayout;
    },
    AudioFrame: class {},
    LocalAudioTrack: { createAudioTrack: mockCreateAudioTrack },
    VideoBufferType: { I420: 0 },
    TrackPublishOptions: class { source: unknown },
    TrackSource: { SOURCE_MICROPHONE: 1 },
  };
});

import { recordRunwaySession } from '@/lib/runway-session';
import { RemoteVideoTrack } from '@livekit/rtc-node';

/** Create a fake FFmpeg/FFprobe spawn process. Emits stdout data + 'close' on next tick. */
function makeSpawnProcess(exitCode = 0, stdoutData?: Buffer) {
  const proc = new EventEmitter() as NodeJS.EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  // Use Promise.resolve().then to emit on the next microtask (fake-timer-safe)
  Promise.resolve().then(() => {
    if (stdoutData) proc.stdout.emit('data', stdoutData);
    proc.emit('close', exitCode);
  });
  return proc;
}

/** Build a fake I420 video frame value. */
function makeFakeFrame(width = 1088, height = 704, timestampUs = 0n) {
  const ySize = width * height;
  const uvSize = ySize / 4;
  const frame = {
    type: 0, // VideoBufferType.I420
    data: new Uint8Array(ySize + uvSize * 2),
    width,
    height,
    convert: vi.fn(),
  };
  frame.convert.mockReturnValue(frame);
  return { frame, timestampUs };
}

const baseCredentials = { url: 'wss://demo.livekit.cloud', token: 'lk-token', roomName: 'room-1' };

/** Small PCM buffer: 5 full 960-sample frames of s16le. */
const fakePcm = Buffer.alloc(960 * 2 * 5, 0);

beforeEach(() => {
  // resetAllMocks clears both call data AND implementation queues so leftover
  // mockImplementationOnce entries from prior tests don't bleed into this one.
  vi.resetAllMocks();

  // ffprobe: return 10s duration
  mockExecFileAsync.mockResolvedValue({ stdout: '10.0\n', stderr: '' });

  // spawn: PCM decode then VP9 encode — use factory so the process is created
  // at call time, ensuring listeners are attached before the close event fires.
  mockSpawn
    .mockImplementationOnce(() => makeSpawnProcess(0, fakePcm))
    .mockImplementationOnce(() => makeSpawnProcess(0));

  // Audio ops succeed immediately
  mockCaptureFrame.mockResolvedValue(undefined);
  mockWaitForPlayout.mockResolvedValue(undefined);
  mockPublishTrack.mockResolvedValue(undefined);
  mockCreateAudioTrack.mockReturnValue({});
  mockRoomDisconnect.mockResolvedValue(undefined);

  // room.connect: fire TrackSubscribed on the next microtask so that
  // videoStreamReady resolves before the audio loop starts.
  mockRoomConnect.mockImplementation(async () => {
    const subHandler = mockRoomOn.mock.calls.find(([event]) => event === 'TrackSubscribed')?.[1] as
      | ((track: unknown) => void)
      | undefined;
    const track = new (RemoteVideoTrack as unknown as new () => object)();
    Promise.resolve().then(() => {
      if (subHandler) void subHandler(track);
    });
  });

  // VideoStream reader: 2 frames then done
  mockVideoStreamReader
    .mockResolvedValueOnce({ done: false, value: makeFakeFrame(1088, 704, 0n) })
    .mockResolvedValueOnce({ done: false, value: makeFakeFrame(1088, 704, 33_333n) })
    .mockResolvedValueOnce({ done: true, value: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordRunwaySession', () => {
  it('connects to LiveKit, publishes audio, and returns video result', async () => {
    const onProgress = vi.fn();
    const result = await recordRunwaySession({
      credentials: baseCredentials,
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
      onProgress,
      _delayMs: { trailing: 0, drain: 0 },
    });

    expect(result.videoPath).toBe('/tmp/output.webm');
    expect(result.durationSeconds).toBe(10.0);
    expect(result.width).toBe(1088);
    expect(result.height).toBe(704);

    expect(mockRoomConnect).toHaveBeenCalledWith(
      baseCredentials.url,
      baseCredentials.token,
      { autoSubscribe: true, dynacast: false },
    );
    expect(mockPublishTrack).toHaveBeenCalled();
    expect(mockWaitForPlayout).toHaveBeenCalled();
    expect(mockRoomDisconnect).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(5);
    expect(onProgress).toHaveBeenCalledWith(10);
    expect(onProgress).toHaveBeenCalledWith(15);
    expect(onProgress).toHaveBeenCalledWith(95);
  });

  it('throws when no video frames are received', async () => {
    // VideoStream immediately returns EOS with 0 frames; drain timer (0ms) wins the race
    mockVideoStreamReader.mockReset().mockResolvedValue({ done: true, value: undefined });

    await expect(
      recordRunwaySession({
        credentials: baseCredentials,
        audioFilePath: '/tmp/speaker.mp3',
        outputVideoPath: '/tmp/output.webm',
        _delayMs: { trailing: 0, drain: 0 },
      }),
    ).rejects.toThrow('No video frames received from Runway session');
  });

  it('publishes audio frames derived from PCM data', async () => {
    await recordRunwaySession({
      credentials: baseCredentials,
      audioFilePath: '/tmp/speaker.mp3',
      outputVideoPath: '/tmp/output.webm',
      _delayMs: { trailing: 0, drain: 0 },
    });

    // 5 PCM frames → 5 captureFrame calls
    expect(mockCaptureFrame).toHaveBeenCalledTimes(5);
  });
});
