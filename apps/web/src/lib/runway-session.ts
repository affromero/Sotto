import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  Room,
  RoomEvent,
  RemoteVideoTrack,
  VideoStream,
  AudioSource,
  AudioFrame,
  LocalAudioTrack,
  VideoBufferType,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import type { RunwaySessionCredentials } from './runway';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

const SAMPLE_RATE = 48_000;
const CHANNELS = 1;
const SAMPLES_PER_FRAME = 960; // 20ms at 48kHz
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2; // int16 = 2 bytes per sample

type RawFrame = {
  data: Uint8Array;
  width: number;
  height: number;
  timestampUs: bigint;
};

export interface RunwayRecordingConfig {
  credentials: RunwaySessionCredentials;
  audioFilePath: string;
  outputVideoPath: string;
  onProgress?: (pct: number) => void;
  /** @internal override timer delays in tests to avoid real wait times */
  _delayMs?: { trailing?: number; drain?: number; videoSubscribe?: number };
}

export interface RunwayRecordingResult {
  videoPath: string;
  durationSeconds: number;
  width: number;
  height: number;
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);
  return parseFloat(stdout.trim());
}

async function decodeToPCM(audioPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', audioPath,
      '-f', 's16le',
      '-ar', `${SAMPLE_RATE}`,
      '-ac', `${CHANNELS}`,
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', () => { /* suppress ffmpeg noise */ });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`FFmpeg PCM decode failed with exit code ${code}`));
      else resolve(Buffer.concat(chunks));
    });
    proc.on('error', reject);
  });
}

function encodeFramesToWebm(
  frames: RawFrame[],
  width: number,
  height: number,
  fps: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'yuv420p',
      '-s', `${width}x${height}`,
      '-r', `${fps}`,
      '-i', 'pipe:0',
      '-c:v', 'libvpx-vp9',
      '-b:v', '4M',
      '-auto-alt-ref', '0',
      '-an',
      outputPath,
    ]);

    proc.stdin.on('error', () => { /* ignore broken pipe on early exit */ });
    proc.stderr.on('data', () => { /* suppress ffmpeg noise */ });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg VP9 encode failed (exit ${code})`));
    });

    for (const frame of frames) {
      proc.stdin.write(frame.data);
    }
    proc.stdin.end();
  });
}

/**
 * Record a Runway realtime session using native Node.js WebRTC via @livekit/rtc-node.
 *
 * Connects directly to the LiveKit room as a native participant — no browser involved.
 * Publishes PCM audio frames, collects raw I420 video frames from the avatar, then
 * encodes them to VP9 WebM via FFmpeg. This approach avoids the fundamental limitation
 * of captureStream() in headless Chromium, which does not capture WebRTC video tracks.
 */
export async function recordRunwaySession(config: RunwayRecordingConfig): Promise<RunwayRecordingResult> {
  const { credentials, audioFilePath, outputVideoPath, onProgress, _delayMs } = config;
  const trailingMs = _delayMs?.trailing ?? 2000;
  const drainMs = _delayMs?.drain ?? 5000;
  const videoSubscribeMs = _delayMs?.videoSubscribe ?? 10_000;

  // Step 1: get audio duration
  const durationSeconds = await getAudioDuration(audioFilePath);
  onProgress?.(5);

  // Step 2: decode audio to raw PCM (s16le, 48kHz, mono)
  const pcmData = await decodeToPCM(audioFilePath);
  onProgress?.(10);

  const room = new Room();
  const collectedFrames: RawFrame[] = [];
  let videoWidth = 0;
  let videoHeight = 0;

  let videoResolve!: () => void;
  let videoReject!: (err: unknown) => void;
  const videoCollectPromise = new Promise<void>((res, rej) => {
    videoResolve = res;
    videoReject = rej;
  });

  // videoStreamReady resolves as soon as the video TrackSubscribed handler runs
  // synchronously far enough to create the VideoStream (before the first await
  // inside the reader loop). We await this BEFORE the audio loop to guarantee the
  // VideoStream is collecting when the avatar starts generating lip-synced video.
  let videoStreamReadyResolve!: () => void;
  const videoStreamReady = new Promise<void>((res) => {
    videoStreamReadyResolve = res;
  });

  let collecting = false;

  // Step 3: register TrackSubscribed handler — creates VideoStream once the avatar's
  // video track is ready.
  //
  // Strategy: connect with autoSubscribe: true so the Rust native SDK handles the
  // subscription immediately (same codepath used by browser clients). We then await
  // videoStreamReady BEFORE the audio loop, while the ffiEventLock queue is still
  // empty, ensuring TrackSubscribed fires quickly.
  //
  // Prior failures:
  //   - autoSubscribe: true alone: TrackSubscribed fires LATE in JS (ffiEventLock
  //     is saturated by captureFrame audio events) → VideoStream created AFTER all
  //     avatar video frames are already sent.
  //   - autoSubscribe: false + manual setSubscribed in TrackPublished: Runway server
  //     closes the idle video stream (no audio flowing yet) → immediate EOS with 0 frames.
  room.on(RoomEvent.TrackSubscribed, async (track) => {
    const isVideo = track instanceof RemoteVideoTrack;
    logger.info('Runway track subscribed', {
      isVideo,
      streamState: isVideo ? track.stream_state : undefined,
      muted: isVideo ? track.muted : undefined,
      trackHandle: isVideo ? track.ffi_handle?.handle?.toString() : undefined,
    });
    if (!(track instanceof RemoteVideoTrack) || collecting) return;
    collecting = true;

    // Resolve videoStreamReady synchronously before the first await so the caller
    // knows the VideoStream is wired up and ready to collect frames.
    videoStreamReadyResolve();

    const stream = new VideoStream(track);
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          logger.info('Runway VideoStream EOS', { framesCollected: collectedFrames.length });
          if (collectedFrames.length > 0) videoResolve();
          break;
        }

        const { frame, timestampUs } = value as { frame: { type: number; data: Uint8Array; width: number; height: number; convert: (t: number) => { data: Uint8Array; width: number; height: number } }; timestampUs: bigint };

        // Convert to I420 if needed (ffmpeg rawvideo expects yuv420p)
        const i420 = frame.type === VideoBufferType.I420
          ? frame
          : frame.convert(VideoBufferType.I420);

        videoWidth = i420.width;
        videoHeight = i420.height;
        collectedFrames.push({
          data: new Uint8Array(i420.data),
          width: i420.width,
          height: i420.height,
          timestampUs,
        });
      }
    } catch (err) {
      videoReject(err);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    if (track instanceof RemoteVideoTrack) {
      logger.info('Runway video track unsubscribed', { framesCollected: collectedFrames.length });
    }
  });

  // Step 4: connect to LiveKit room with autoSubscribe: true
  await room.connect(credentials.url, credentials.token, { autoSubscribe: true, dynacast: false });
  onProgress?.(15);

  // Step 4.5: wait for TrackSubscribed (video) BEFORE the audio loop.
  // With autoSubscribe: true, Rust subscribes natively during connect; the JS
  // TrackSubscribed event fires quickly since ffiEventLock is empty at this point.
  await Promise.race([
    videoStreamReady,
    new Promise<void>((_, rej) =>
      setTimeout(
        () => rej(new Error('Runway video track not subscribed within timeout')),
        videoSubscribeMs,
      ),
    ),
  ]);
  logger.info('Runway VideoStream ready — starting audio');

  // Step 5: publish audio track — must use SOURCE_MICROPHONE so Runway recognises it as speech
  const audioSource = new AudioSource(SAMPLE_RATE, CHANNELS);
  const audioTrack = LocalAudioTrack.createAudioTrack('runway-audio', audioSource);
  const publishOpts = new TrackPublishOptions();
  publishOpts.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(audioTrack, publishOpts);
  onProgress?.(20);

  // Step 6: push PCM frames to AudioSource
  const totalAudioFrames = Math.ceil(pcmData.length / BYTES_PER_FRAME);
  for (let i = 0; i < totalAudioFrames; i++) {
    const start = i * BYTES_PER_FRAME;
    const end = Math.min(start + BYTES_PER_FRAME, pcmData.length);
    const slice = pcmData.subarray(start, end);

    // Pad last frame to full frame size
    const padded =
      slice.length < BYTES_PER_FRAME
        ? Buffer.concat([slice, Buffer.alloc(BYTES_PER_FRAME - slice.length)])
        : slice;

    await audioSource.captureFrame(
      new AudioFrame(
        new Int16Array(padded.buffer, padded.byteOffset, SAMPLES_PER_FRAME),
        SAMPLE_RATE,
        CHANNELS,
        SAMPLES_PER_FRAME,
      ),
    );

    const pct = Math.round(20 + (i / totalAudioFrames) * 50);
    onProgress?.(pct);
  }

  // Step 7: wait for audio playout to complete, then allow 2s trailing frames
  await audioSource.waitForPlayout();
  onProgress?.(72);
  await new Promise((r) => setTimeout(r, trailingMs));

  // Step 8: disconnect and drain video frames
  await room.disconnect();

  // Give VideoStream reader up to drainMs to finish draining after disconnect
  await Promise.race([
    videoCollectPromise,
    new Promise<void>((r) => setTimeout(r, drainMs)),
  ]);
  onProgress?.(80);

  if (collectedFrames.length === 0) {
    throw new Error('No video frames received from Runway session');
  }

  // Step 9: calculate fps from timestamps
  const fps =
    collectedFrames.length > 1
      ? Math.max(
          1,
          Math.round(
            (collectedFrames.length - 1) /
              (Number(
                collectedFrames[collectedFrames.length - 1]!.timestampUs -
                  collectedFrames[0]!.timestampUs,
              ) /
                1_000_000),
          ),
        )
      : 25;

  logger.info('Runway frames collected', {
    frames: collectedFrames.length,
    fps,
    width: videoWidth,
    height: videoHeight,
  });

  // Step 10: encode I420 frames → VP9 WebM via FFmpeg
  await encodeFramesToWebm(collectedFrames, videoWidth, videoHeight, fps, outputVideoPath);
  onProgress?.(95);

  return {
    videoPath: outputVideoPath,
    durationSeconds,
    width: videoWidth,
    height: videoHeight,
  };
}
