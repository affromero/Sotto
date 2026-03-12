import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { chromium } from 'playwright';
import type { RunwaySessionCredentials } from './runway';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

// livekit-client v2 UMD bundle — used inside headless Chrome to connect to LiveKit.
// Using browser WebRTC avoids the H264 decode failure in @livekit/rtc-node's
// Darwin arm64 binary (compiled without FFmpeg H264 or VideoToolbox activation).
const LIVEKIT_CLIENT_CDN =
  'https://cdn.jsdelivr.net/npm/livekit-client@2.10.0/dist/livekit-client.umd.min.js';

export interface RunwayRecordingConfig {
  credentials: RunwaySessionCredentials;
  audioFilePath: string;
  outputVideoPath: string;
  onProgress?: (pct: number) => void;
  /** @internal override timer delays in tests */
  _delayMs?: { trailing?: number };
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

/**
 * Record a Runway realtime session using headless Chrome via Playwright.
 *
 * Why Playwright instead of @livekit/rtc-node:
 *   The livekit-ffi Darwin arm64 binary was compiled without FFmpeg H264 support
 *   and without VideoToolbox activation, so every incoming H264 RTP packet fails to
 *   decode ("FFmpeg H.264 decoder not found", "Failed to initialize decoder"), resulting
 *   in 0 video frames. Headless Chrome has native H264 decode (VideoToolbox on macOS,
 *   software codec via system libraries on Linux), so the browser approach produces a
 *   working VP9 WebM reliably across platforms.
 *
 * Approach:
 *   1. Load livekit-client browser SDK from CDN into headless Chrome
 *   2. Connect to the LiveKit room as a browser participant
 *   3. Subscribe to the avatar's H264 video track (Chrome decodes it natively)
 *   4. Build a synthetic microphone from the audio file via AudioContext
 *   5. Publish the synthetic audio track so Runway generates lip-synced video
 *   6. Record the decoded video stream with MediaRecorder (VP9/VP8 WebM)
 *   7. Stream encoded chunks back to Node.js via page.exposeFunction
 *   8. Write the concatenated chunks to outputVideoPath
 */
export async function recordRunwaySession(config: RunwayRecordingConfig): Promise<RunwayRecordingResult> {
  const { credentials, audioFilePath, outputVideoPath, onProgress, _delayMs } = config;
  const trailingMs = _delayMs?.trailing ?? 2000;

  // Step 1: get audio duration
  const durationSeconds = await getAudioDuration(audioFilePath);
  onProgress?.(5);

  // Step 2: read audio as base64 data URL for browser consumption
  const audioBuffer = await readFile(audioFilePath);
  const audioDataUrl = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;
  onProgress?.(10);

  logger.info('Launching headless Chrome for Runway recording', {
    audioFilePath,
    outputVideoPath,
    durationSeconds,
  });

  // Step 3: launch headless Chrome
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') logger.error('Runway browser error', { text: msg.text() });
    else if (type === 'warning') logger.warn('Runway browser warning', { text: msg.text() });
    else logger.debug('Runway browser log', { text: msg.text() });
  });

  // Step 4: collect video chunks from the browser
  const chunkBuffers: Buffer[] = [];
  await page.exposeFunction('onVideoChunk', (base64: string) => {
    chunkBuffers.push(Buffer.from(base64, 'base64'));
  });

  await page.exposeFunction('reportProgress', (pct: number) => {
    onProgress?.(pct);
  });

  // Step 5: load livekit-client from CDN
  await page.goto('about:blank');
  await page.addScriptTag({ url: LIVEKIT_CLIENT_CDN });
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).LivekitClient);
  onProgress?.(15);

  // Step 6: run the full recording session inside the browser
  const result = await page.evaluate(
    async (params) => {
      const win = window as unknown as Record<string, unknown>;
      const report = win.reportProgress as (pct: number) => void;
      const LK = win.LivekitClient as Record<string, unknown>;
      const Room = LK.Room as new () => Record<string, unknown>;
      const RoomEvent = LK.RoomEvent as Record<string, string>;
      const Track = LK.Track as Record<string, Record<string, string>>;
      const LocalAudioTrack = LK.LocalAudioTrack as new (
        track: MediaStreamTrack,
        constraints?: unknown,
        userProvidedTrack?: boolean,
      ) => Record<string, unknown>;

      const { credentials, audioDataUrl, durationSeconds, trailingMs } = params;

      const room = new Room();

      // 6a. Subscribe to video → start MediaRecorder
      let width = 1088;
      let height = 704;

      const videoReadyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Video track not subscribed within 15s')),
          15_000,
        );

        (room as Record<string, (event: string, cb: (...args: unknown[]) => void) => void>).on(
          RoomEvent.TrackSubscribed,
          (...args: unknown[]) => {
            const track = args[0] as Record<string, unknown>;
            const pub = args[1] as Record<string, unknown>;
            const kind = track.kind as string;
            if (kind !== Track.Kind.Video) return;
            clearTimeout(timeout);

            width = (pub.dimensions as Record<string, number> | undefined)?.width ?? 1088;
            height = (pub.dimensions as Record<string, number> | undefined)?.height ?? 704;

            const mediaStreamTrack = track.mediaStreamTrack as MediaStreamTrack;
            const stream = new MediaStream([mediaStreamTrack]);

            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
              ? 'video/webm;codecs=vp9'
              : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
                ? 'video/webm;codecs=vp8'
                : 'video/webm';

            const recorder = new MediaRecorder(stream, { mimeType });
            win.__recorder = recorder;

            recorder.ondataavailable = (e: BlobEvent) => {
              if (e.data.size > 0) {
                const reader = new FileReader();
                reader.onload = () => {
                  const base64 = (reader.result as string).split(',')[1];
                  (win.onVideoChunk as (b: string) => void)(base64);
                };
                reader.readAsDataURL(e.data);
              }
            };

            recorder.start(200);
            resolve();
          },
        );
      });

      // 6b. Connect to LiveKit room
      await (
        room as Record<
          string,
          (url: string, token: string, opts: Record<string, unknown>) => Promise<void>
        >
      ).connect(credentials.url, credentials.token, {
        autoSubscribe: true,
        dynacast: false,
      });
      report(20);

      // 6c. Wait for video track
      await videoReadyPromise;
      report(25);

      // 6d. Build synthetic audio from data URL via AudioContext
      const audioCtx = new AudioContext({ sampleRate: 48000 });
      await audioCtx.resume();

      const fetchResp = await fetch(audioDataUrl);
      const audioArrayBuffer = await fetchResp.arrayBuffer();
      const audioBufferNode = await audioCtx.decodeAudioData(audioArrayBuffer);

      const bufferSource = audioCtx.createBufferSource();
      bufferSource.buffer = audioBufferNode;
      const dest = audioCtx.createMediaStreamDestination();
      bufferSource.connect(dest);

      // 6e. Publish audio track as microphone so Runway generates lip-synced video
      const audioMediaTrack = dest.stream.getAudioTracks()[0];
      const localAudioTrack = new LocalAudioTrack(audioMediaTrack, undefined, false);
      await (
        room as Record<
          string,
          Record<
            string,
            (track: unknown, opts: Record<string, unknown>) => Promise<void>
          >
        >
      ).localParticipant.publishTrack(localAudioTrack, {
        source: Track.Source.Microphone,
      });
      report(30);

      // 6f. Play audio and wait for it to finish
      const audioPlayDone = new Promise<void>((resolve) => {
        bufferSource.onended = () => resolve();
      });
      bufferSource.start();

      const progressInterval = setInterval(() => {
        const elapsed = (audioCtx.currentTime / durationSeconds) * 50;
        report(Math.round(30 + elapsed));
      }, 500);

      await audioPlayDone;
      clearInterval(progressInterval);
      report(80);

      // 6g. Trailing frames then stop recording
      await new Promise((r) => setTimeout(r, trailingMs));

      const recorder = win.__recorder as MediaRecorder;
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }

      // 6h. Disconnect
      await (room as Record<string, () => Promise<void>>).disconnect();

      return { width, height, error: null as string | null };
    },
    { credentials, audioDataUrl, durationSeconds, trailingMs },
  );

  await browser.close();

  if (result.error) {
    throw new Error(result.error);
  }

  if (chunkBuffers.length === 0) {
    throw new Error('No video chunks received from Runway browser session');
  }

  logger.info('Runway browser session complete', {
    chunks: chunkBuffers.length,
    width: result.width,
    height: result.height,
  });

  // Step 7: write concatenated WebM chunks to output
  const videoData = Buffer.concat(chunkBuffers);
  await writeFile(outputVideoPath, videoData);
  onProgress?.(95);

  return {
    videoPath: outputVideoPath,
    durationSeconds,
    width: result.width,
    height: result.height,
  };
}
