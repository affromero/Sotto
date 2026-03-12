/* eslint-disable */
/**
 * Browser-based Runway recording test using Playwright.
 * Bypasses livekit-rtc-node's broken H264 decoder by running
 * the entire session in headless Chrome, which has native H264 decode.
 *
 * Run from apps/web/:
 *   doppler run --project sotto --config dev -- npx tsx scripts/test-runway-browser.ts
 */
import { chromium } from 'playwright';
import { writeFile, rm, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRealtimeSession, pollSessionReady, consumeSession, deleteSession } from '../src/lib/runway';

const execFileAsync = promisify(execFile);

const AUDIO_URL =
  'https://pub-cdb1bb3318a3477c9f1a76249243a81c.r2.dev/podcasts/cmmndizqz000h06us1q6gljgf/avatars/HOST-audio.mp3';
const AVATAR_ID = 'cat-character';
const OUTPUT = '/tmp/test-runway-browser.webm';

// livekit-client v2 UMD bundle from CDN
const LIVEKIT_CLIENT_CDN =
  'https://cdn.jsdelivr.net/npm/livekit-client@2.10.0/dist/livekit-client.umd.min.js';

async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);
  return parseFloat(stdout.trim());
}

async function main() {
  const API_KEY = process.env.RUNWAY_API_KEY;
  if (!API_KEY) throw new Error('RUNWAY_API_KEY not set');

  const tmpDir = join(tmpdir(), `runway-browser-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  console.log('Downloading audio...');
  const res = await fetch(AUDIO_URL);
  if (!res.ok) throw new Error(`Failed to download audio: ${res.status}`);
  const audioPath = join(tmpDir, 'audio.mp3');
  await writeFile(audioPath, Buffer.from(await res.arrayBuffer()));
  console.log('Audio saved to', audioPath);

  const durationSeconds = await getAudioDuration(audioPath);
  console.log('Audio duration:', durationSeconds.toFixed(2), 's');

  console.log('Creating Runway realtime session...');
  const sessionId = await createRealtimeSession({
    apiKey: API_KEY,
    avatarId: AVATAR_ID,
    isPreset: true,
    maxDuration: 300,
  });
  console.log('Session ID:', sessionId);

  try {
    console.log('Polling until session ready...');
    const sessionKey = await pollSessionReady({ apiKey: API_KEY, sessionId });
    console.log('Session ready');

    console.log('Consuming session for LiveKit credentials...');
    const credentials = await consumeSession({ sessionKey, sessionId });
    console.log('LiveKit URL:', credentials.url);
    console.log('Room:', credentials.roomName);

    // Read audio as base64 data URL for browser
    const audioBuffer = await readFile(audioPath);
    const audioDataUrl = `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`;

    console.log('Launching headless Chrome...');
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

    // Capture browser console for debugging
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') console.error('[browser:error]', msg.text());
      else if (type === 'warning') console.warn('[browser:warn]', msg.text());
      else console.log('[browser:log]', msg.text());
    });

    // Expose video chunk callback — write chunks to file incrementally
    const chunkBuffers: Buffer[] = [];
    await page.exposeFunction('onVideoChunk', async (base64: string) => {
      chunkBuffers.push(Buffer.from(base64, 'base64'));
      process.stdout.write('.');
    });

    await page.exposeFunction('reportProgress', (pct: number) => {
      process.stdout.write(`\r  progress: ${pct}%   `);
    });

    // Load livekit-client from CDN
    console.log('Loading livekit-client from CDN...');
    await page.goto('about:blank');
    await page.addScriptTag({ url: LIVEKIT_CLIENT_CDN });
    await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).LivekitClient);
    console.log('livekit-client loaded');

    // Run the session in the browser
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

        const { credentials, audioDataUrl, durationSeconds } = params;

        const room = new Room();

        // --- 1. Subscribe to video and start recording ---
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

              console.log('[browser] Starting MediaRecorder with mime:', mimeType);

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

              recorder.start(200); // 200ms chunks
              console.log('[browser] MediaRecorder started');
              resolve();
            },
          );
        });

        // --- 2. Connect to the room ---
        console.log('[browser] Connecting to LiveKit room...');
        await (
          room as Record<
            string,
            (url: string, token: string, opts: Record<string, unknown>) => Promise<void>
          >
        ).connect(credentials.url, credentials.token, {
          autoSubscribe: true,
          dynacast: false,
        });
        console.log('[browser] Connected');
        report(15);

        // --- 3. Wait for video to be ready ---
        await videoReadyPromise;
        console.log('[browser] VideoStream ready');
        report(20);

        // --- 4. Create synthetic audio from data URL ---
        const audioCtx = new AudioContext({ sampleRate: 48000 });
        await audioCtx.resume();

        const fetchResp = await fetch(audioDataUrl);
        const audioArrayBuffer = await fetchResp.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);

        const bufferSource = audioCtx.createBufferSource();
        bufferSource.buffer = audioBuffer;
        const dest = audioCtx.createMediaStreamDestination();
        bufferSource.connect(dest);

        // --- 5. Publish audio track to LiveKit ---
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
        console.log('[browser] Audio track published');
        report(25);

        // --- 6. Play audio ---
        const audioPlayDone = new Promise<void>((resolve) => {
          bufferSource.onended = () => resolve();
        });
        bufferSource.start();
        console.log('[browser] Audio playing...');

        // Report progress periodically during audio playback
        const progressInterval = setInterval(() => {
          const elapsed =
            (audioCtx.currentTime / durationSeconds) * 50;
          report(Math.round(20 + elapsed));
        }, 500);

        await audioPlayDone;
        clearInterval(progressInterval);
        console.log('[browser] Audio finished');
        report(72);

        // --- 7. Trailing frames ---
        await new Promise((r) => setTimeout(r, 2000));

        // --- 8. Stop recording ---
        const recorder = win.__recorder as MediaRecorder;
        if (recorder && recorder.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
            recorder.stop();
          });
        }
        console.log('[browser] Recording stopped');
        report(80);

        // --- 9. Disconnect ---
        await (room as Record<string, () => Promise<void>>).disconnect();

        return { width, height, error: null };
      },
      { credentials, audioDataUrl, durationSeconds },
    );

    await browser.close();
    console.log('\nBrowser session complete:', result);

    if (result.error) {
      throw new Error(result.error as string);
    }

    if (chunkBuffers.length === 0) {
      throw new Error('No video chunks received from browser session');
    }

    // Write output
    const videoData = Buffer.concat(chunkBuffers);
    await writeFile(OUTPUT, videoData);
    console.log(`\nOutput written: ${OUTPUT} (${(videoData.length / 1024).toFixed(0)} KB)`);
    console.log('Width:', result.width, 'Height:', result.height);
    console.log('To view: open', OUTPUT);
  } finally {
    await deleteSession({ apiKey: API_KEY, sessionId }).catch((e: unknown) =>
      console.warn('Failed to delete session:', (e as Error).message),
    );
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
