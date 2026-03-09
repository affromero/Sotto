import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { RunwaySessionCredentials } from './runway';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export interface RunwayRecordingConfig {
  credentials: RunwaySessionCredentials;
  audioFilePath: string;
  outputVideoPath: string;
  onProgress?: (pct: number) => void;
}

export interface RunwayRecordingResult {
  videoPath: string;
  durationSeconds: number;
  width: number;
  height: number;
}

/** Convert audio file to base64 WAV (48kHz mono) for browser playback. */
async function audioToBase64Wav(audioPath: string): Promise<{ base64: string; durationSeconds: number }> {
  const { stdout: durationStr } = await execFileAsync('ffprobe', [
    '-v', 'quiet', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', audioPath,
  ]);
  const durationSeconds = parseFloat(durationStr.trim());

  const { stdout } = await execFileAsync('ffmpeg', [
    '-i', audioPath, '-f', 'wav', '-ar', '48000', '-ac', '1', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 });

  return { base64: (stdout as unknown as Buffer).toString('base64'), durationSeconds };
}

function buildCapturePage(livekitJs: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body>
<video id="remoteVideo" autoplay muted playsinline style="width:1088px;height:704px;background:#000"></video>
<script>${livekitJs}</script>
<script>
window.__captureState = { connected: false, recordingDone: false, error: null, videoBase64: null };

window.runCapture = async function(config) {
  try {
    const room = new LivekitClient.Room({ adaptiveStream: false, dynacast: false });

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === LivekitClient.Track.Kind.Video) {
        const el = document.getElementById('remoteVideo');
        track.attach(el);
      }
    });

    await room.connect(config.url, config.token);
    window.__captureState.connected = true;

    // Decode audio and publish
    const audioBytes = Uint8Array.from(atob(config.audioBase64), c => c.charCodeAt(0));
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const audioBuffer = await audioCtx.decodeAudioData(audioBytes.buffer);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);

    const audioTrack = new LivekitClient.LocalAudioTrack(dest.stream.getAudioTracks()[0]);
    await room.localParticipant.publishTrack(audioTrack);

    // Wait for remote video
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const el = document.getElementById('remoteVideo');
        if (el && el.videoWidth > 0) { clearInterval(check); resolve(); }
      }, 100);
    });

    // Start recording
    const videoEl = document.getElementById('remoteVideo');
    const stream = videoEl.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 4000000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        window.__captureState.videoBase64 = reader.result.split(',')[1];
        window.__captureState.recordingDone = true;
      };
      reader.readAsDataURL(blob);
    };

    recorder.start(1000);
    source.start(0);

    // Wait for audio to finish
    await new Promise((resolve) => { source.onended = resolve; });

    // Small buffer for any trailing video frames
    await new Promise((resolve) => setTimeout(resolve, 1000));
    recorder.stop();

    // Disconnect
    room.disconnect();
  } catch (err) {
    window.__captureState.error = err.message || String(err);
  }
};
</script>
</body></html>`;
}

/**
 * Record a Runway realtime session via headless Chromium.
 * Connects to LiveKit, publishes audio, captures avatar video via MediaRecorder.
 */
export async function recordRunwaySession(config: RunwayRecordingConfig): Promise<RunwayRecordingResult> {
  const { credentials, audioFilePath, outputVideoPath, onProgress } = config;

  // Convert audio to base64 WAV
  const { base64: audioBase64, durationSeconds } = await audioToBase64Wav(audioFilePath);
  onProgress?.(10);

  // Load vendored livekit-client
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const livekitJs = readFileSync(join(currentDir, 'vendor', 'livekit-client.umd.js'), 'utf-8');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
    ],
  });

  try {
    const page = await browser.newPage();

    const html = buildCapturePage(livekitJs);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    onProgress?.(20);

    // Start capture
    await page.evaluate(
      (cfg: { url: string; token: string; roomName: string; audioBase64: string }) => {
        (window as unknown as { runCapture: (c: typeof cfg) => void }).runCapture(cfg);
      },
      {
        url: credentials.url,
        token: credentials.token,
        roomName: credentials.roomName,
        audioBase64,
      },
    );

    // Poll for completion
    const timeoutMs = (durationSeconds + 30) * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const state = await page.evaluate(() =>
        (window as unknown as { __captureState: { recordingDone: boolean; error: string | null; videoBase64: string | null } }).__captureState,
      );

      if (state.error) {
        throw new Error(`Runway capture error: ${state.error}`);
      }

      if (state.recordingDone && state.videoBase64) {
        onProgress?.(80);

        // Write video to file
        const videoBuffer = Buffer.from(state.videoBase64, 'base64');
        await writeFile(outputVideoPath, videoBuffer);

        onProgress?.(90);

        return {
          videoPath: outputVideoPath,
          durationSeconds,
          width: 1088,
          height: 704,
        };
      }

      // Report progress based on elapsed time
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(75, 20 + (elapsed / durationSeconds) * 55);
      onProgress?.(Math.round(pct));

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Runway recording timed out after ${Math.round(timeoutMs / 1000)}s`);
  } finally {
    await browser.close().catch((err: unknown) => {
      logger.warn('Failed to close Playwright browser', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
