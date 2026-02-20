import { logger } from './logger';
import { prismaUnfiltered as prisma } from './prisma';

const DUPLICATE_THRESHOLD = 0.78;
const CHALLENGE_THRESHOLD = 0.72;

interface SpeakerEmbeddingExtractor {
  dim: number;
  createStream(): EmbeddingStream;
  compute(stream: EmbeddingStream): Float32Array;
}

interface EmbeddingStream {
  acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

interface SherpaReadWaveResult {
  samples: Float32Array;
  sampleRate: number;
}

let extractor: SpeakerEmbeddingExtractor | null = null;

function getExtractor(): SpeakerEmbeddingExtractor {
  if (extractor) return extractor;

  const modelPath = process.env.SHERPA_ONNX_MODEL_PATH;
  if (!modelPath) {
    throw new Error('SHERPA_ONNX_MODEL_PATH not configured');
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa_onnx = require('sherpa-onnx');
  extractor = new sherpa_onnx.SpeakerEmbeddingExtractor({
    model: modelPath,
    numThreads: 1,
    debug: false,
  }) as SpeakerEmbeddingExtractor;

  logger.info('Speaker embedding extractor initialized', { dim: extractor!.dim });
  return extractor!;
}

async function audioBufferToWav(audioBuffer: Buffer): Promise<string> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  const { randomUUID } = await import('crypto');

  const execFileAsync = promisify(execFile);
  const inputPath = join(tmpdir(), `voice-in-${randomUUID()}`);
  const outputPath = join(tmpdir(), `voice-out-${randomUUID()}.wav`);

  const { writeFile, unlink } = await import('fs/promises');
  await writeFile(inputPath, audioBuffer);

  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      '-y',
      outputPath,
    ]);
    return outputPath;
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

export async function extractVoiceprint(audioBuffer: Buffer): Promise<number[]> {
  const ext = getExtractor();
  const wavPath = await audioBufferToWav(audioBuffer);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sherpa_onnx = require('sherpa-onnx');
    const wave: SherpaReadWaveResult = sherpa_onnx.readWave(wavPath);

    const stream = ext.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    stream.inputFinished();

    const embedding = ext.compute(stream);
    return Array.from(embedding);
  } finally {
    const { unlink } = await import('fs/promises');
    await unlink(wavPath).catch(() => {});
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Embedding dimension mismatch');

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export interface SimilarityResult {
  voiceCloneId: string;
  similarity: number;
}

export async function findDuplicateVoiceprints(
  embedding: number[],
  excludeId?: string
): Promise<SimilarityResult[]> {
  const fingerprints = await prisma.voiceFingerprint.findMany({
    where: {
      voiceClone: {
        verificationStatus: { in: ['VERIFIED', 'ADMIN_VERIFIED', 'PROTECTED'] },
      },
      ...(excludeId ? { voiceCloneId: { not: excludeId } } : {}),
    },
    select: {
      voiceCloneId: true,
      embedding: true,
    },
  });

  const matches: SimilarityResult[] = [];
  for (const fp of fingerprints) {
    const sim = cosineSimilarity(embedding, fp.embedding);
    if (sim >= DUPLICATE_THRESHOLD) {
      matches.push({ voiceCloneId: fp.voiceCloneId, similarity: sim });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

export async function verifyChallenge(
  liveEmbedding: number[],
  voiceCloneId: string
): Promise<{ similarity: number; passed: boolean }> {
  const fingerprint = await prisma.voiceFingerprint.findUnique({
    where: { voiceCloneId },
    select: { embedding: true },
  });

  if (!fingerprint) {
    throw new Error(`No fingerprint found for voice clone ${voiceCloneId}`);
  }

  const similarity = cosineSimilarity(liveEmbedding, fingerprint.embedding);
  return { similarity, passed: similarity >= CHALLENGE_THRESHOLD };
}
