import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CartesiaProvider } from '../src/lib/providers/tts/cartesia.provider';
import { createSttProvider } from '../src/lib/providers/stt';

type SmokeStatus = 'pass' | 'skip' | 'fail';

interface SmokeResult {
  name: string;
  status: SmokeStatus;
  detail: string;
}

const language = process.env.SOTTO_AUDIO_SMOKE_LANGUAGE ?? 'es';
const text = process.env.SOTTO_AUDIO_SMOKE_TEXT ?? 'Hola.';
const results: SmokeResult[] = [];

function record(name: string, status: SmokeStatus, detail: string) {
  results.push({ name, status, detail });
  const prefix = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
  console.log(`${prefix} ${name}: ${detail}`);
}

async function smokePexels() {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    record('Pexels visual cues', 'skip', 'PEXELS_API_KEY is not set.');
    return;
  }

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', 'language learning classroom');
  url.searchParams.set('per_page', '1');
  url.searchParams.set('orientation', 'landscape');

  const response = await fetch(url, { headers: { Authorization: key }, cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Pexels returned ${response.status}`);
  }
  const data = (await response.json()) as { photos?: unknown[] };
  record('Pexels visual cues', 'pass', `${data.photos?.length ?? 0} image result returned.`);
}

async function getSmokeAudio(): Promise<Buffer | null> {
  const audioFile = process.env.SOTTO_AUDIO_SMOKE_FILE;
  if (audioFile) {
    const audio = await readFile(audioFile);
    record('Sample audio', 'pass', `Loaded ${audio.length} bytes from SOTTO_AUDIO_SMOKE_FILE.`);
    return audio;
  }

  if (!process.env.CARTESIA_API_KEY) {
    record('Cartesia TTS', 'skip', 'CARTESIA_API_KEY is not set and no sample audio was supplied.');
    return null;
  }

  const provider = new CartesiaProvider(process.env.CARTESIA_API_KEY, 'sonic-3');
  const voiceId = provider.getVoiceId('HOST', 'audio-smoke');
  const audio = await provider.generateSpeech({ text, voiceId, language, speaker: 'HOST' });
  const out = join(tmpdir(), 'sotto-audio-provider-smoke.mp3');
  await writeFile(out, audio);
  record('Cartesia TTS', 'pass', `Generated ${audio.length} bytes at ${out}.`);
  return audio;
}

async function smokeStt(providerId: 'openai' | 'elevenlabs', audio: Buffer) {
  const envVar = providerId === 'openai' ? 'OPENAI_API_KEY' : 'ELEVENLABS_API_KEY';
  const key = process.env[envVar];
  if (!key) {
    record(`${providerId} STT`, 'skip', `${envVar} is not set.`);
    return;
  }

  const model = providerId === 'openai' ? 'whisper-1' : 'scribe_v1';
  const provider = createSttProvider(providerId, key, model);
  const result = await provider.transcribe(audio, { language });
  const transcript = result.text.trim().replace(/\s+/g, ' ');
  record(
    `${providerId} STT`,
    'pass',
    `Transcribed "${transcript}" with language ${result.language ?? 'unknown'}.`
  );
}

async function run() {
  try {
    await smokePexels();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('Pexels visual cues', 'fail', message);
  }

  let audio: Buffer | null = null;
  try {
    audio = await getSmokeAudio();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record('Cartesia TTS', 'fail', message);
  }

  if (audio) {
    for (const providerId of ['openai', 'elevenlabs'] as const) {
      try {
        await smokeStt(providerId, audio);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        record(`${providerId} STT`, 'fail', message);
      }
    }
  }

  const failures = results.filter((result) => result.status === 'fail');
  if (failures.length > 0) process.exitCode = 1;
}

void run();
