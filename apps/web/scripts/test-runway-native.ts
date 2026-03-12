/* eslint-disable */
/**
 * Manual end-to-end test of the new @livekit/rtc-node recording implementation.
 * Run from apps/web/:
 *   doppler run --project sotto --config dev -- npx tsx scripts/test-runway-native.ts
 */
import { writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRealtimeSession, pollSessionReady, consumeSession, deleteSession } from '../src/lib/runway';
import { recordRunwaySession } from '../src/lib/runway-session';

// Debug: tap FfiClient singleton (stored on globalThis._ffiClientInstance) to trace
// all videoStreamEvent FFI events and Rust log output. FfiClient is lazily created on
// first room.connect(), so we poll until it's available.
async function waitForFfiAndInstallDebug(): Promise<() => number> {
  // Poll until FfiClient singleton exists (created inside room.connect())
  while (!(globalThis as Record<string, unknown>)._ffiClientInstance) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const ffi = (globalThis as Record<string, unknown>)._ffiClientInstance as import('events').EventEmitter;
  let videoEventCount = 0;
  ffi.on('ffi_event', (ev: Record<string, unknown>) => {
    const msg = ev.message as Record<string, unknown> | undefined;
    if (msg?.case === 'videoStreamEvent') {
      videoEventCount++;
      const val = msg.value as Record<string, unknown>;
      const inner = (val?.message as Record<string, unknown>)?.case;
      process.stdout.write(`\n[FFI] videoStreamEvent.${inner} handle=${val.streamHandle}\n`);
    } else if (msg?.case === 'logs') {
      // Print Rust-side log records — critical for diagnosing H264 decoder errors
      const batch = msg.value as Record<string, unknown>;
      const records = (batch?.records as Record<string, unknown>[]) ?? [];
      for (const rec of records) {
        const level = rec.level as number; // 0=ERROR,1=WARN,2=INFO,3=DEBUG,4=TRACE
        if (level <= 1) { // ERROR and WARN only to avoid noise
          const levelStr = level === 0 ? 'ERROR' : 'WARN';
          process.stdout.write(`\n[FFI:${levelStr}] ${rec.message}\n`);
        }
      }
    } else if (msg?.case === 'panic') {
      process.stdout.write(`\n[FFI:PANIC] ${JSON.stringify(msg.value)}\n`);
    }
  });
  console.log('[debug] FfiClient debug listener installed (video + rust logs)');
  return () => videoEventCount;
}

const AUDIO_URL =
  'https://pub-cdb1bb3318a3477c9f1a76249243a81c.r2.dev/podcasts/cmmndizqz000h06us1q6gljgf/avatars/HOST-audio.mp3';
const AVATAR_ID = 'cat-character';
const OUTPUT = '/tmp/test-runway-native.webm';

async function main() {
  const API_KEY = process.env.RUNWAY_API_KEY;
  if (!API_KEY) throw new Error('RUNWAY_API_KEY not set');

  const tmpDir = join(tmpdir(), `runway-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  console.log('Downloading audio...');
  const res = await fetch(AUDIO_URL);
  if (!res.ok) throw new Error(`Failed to download audio: ${res.status}`);
  const audioPath = join(tmpDir, 'audio.mp3');
  await writeFile(audioPath, Buffer.from(await res.arrayBuffer()));
  console.log('Audio saved to', audioPath);

  console.log('Creating Runway realtime session...');
  const sessionId = await createRealtimeSession({
    apiKey: API_KEY,
    avatarId: AVATAR_ID,
    isPreset: true,
    maxDuration: 300,
  });
  console.log('Session ID:', sessionId);

  let getVideoEventCount: (() => number) | undefined;
  try {
    console.log('Polling until session ready...');
    const sessionKey = await pollSessionReady({ apiKey: API_KEY, sessionId });
    console.log('Session ready');

    console.log('Consuming session for LiveKit credentials...');
    const credentials = await consumeSession({ sessionKey, sessionId });
    console.log('LiveKit URL:', credentials.url);
    console.log('Room:', credentials.roomName);

    console.log('Recording session with native @livekit/rtc-node...');
    // Start recording + debug listener concurrently; debug polls until FfiClient is ready
    const [result, debugFn] = await Promise.all([
      recordRunwaySession({
        credentials,
        audioFilePath: audioPath,
        outputVideoPath: OUTPUT,
        onProgress: (pct) => process.stdout.write(`\r  progress: ${pct}%   `),
      }),
      waitForFfiAndInstallDebug(),
    ]);
    getVideoEventCount = debugFn;
    console.log('\nDone:', result);
    console.log('Output:', OUTPUT);
  } finally {
    console.log('\n[debug] total videoStreamEvent FFI events:', getVideoEventCount?.());
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
