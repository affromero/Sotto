import * as path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../prisma';
import { createStorageProvider } from '../providers/storage';
import { getSiteConfig, setSiteConfig } from '../site-config';
import { invalidateServerInfra } from '../server-config';
import { logger } from '../logger';

export type StorageProviderId = 'local' | 'r2' | 's3';

export interface StorageMigrationOptions {
  targetProvider: StorageProviderId;
  s3Bucket?: string | null;
  s3Region?: string | null;
  dryRun?: boolean;
  switchAfter?: boolean;
  adminId: string;
}

export interface StorageMigrationResult {
  sourceProvider: StorageProviderId;
  targetProvider: StorageProviderId;
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  switched: boolean;
  errors: Array<{ id: string; field: string; error: string }>;
}

interface StorageRef {
  id: string;
  field: string;
  value: string;
  update(value: string): Promise<unknown>;
}

const STORAGE_KEY_PREFIXES = [
  'episodes/',
  'speaking-ref/',
  'learning-targets/',
  'worksheets/',
  'avatars/',
  'profiles/',
  'recordings/',
];

function isStorageProviderId(value: string | null | undefined): value is StorageProviderId {
  return value === 'local' || value === 'r2' || value === 's3';
}

function effectiveStorageProvider(configProvider: string | null): StorageProviderId {
  if (isStorageProviderId(configProvider)) return configProvider;
  if (isStorageProviderId(process.env.STORAGE_PROVIDER)) return process.env.STORAGE_PROVIDER;
  return 'local';
}

function localBaseDir(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.LOCAL_STORAGE_DIR || '/tmp/sotto-storage'
  );
}

function keyFromLocalUrl(value: string): string | null {
  if (!value.startsWith('file://')) return null;
  const filePath = fileURLToPath(value);
  const relative = path.relative(localBaseDir(), filePath).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function keyFromKnownPublicUrl(
  value: string,
  s3Bucket: string | null,
  s3Region: string | null
): string | null {
  const r2PublicUrl = process.env.R2_PUBLIC_URL?.trim();
  if (r2PublicUrl && value.startsWith(`${r2PublicUrl}/`)) {
    return value.slice(r2PublicUrl.length + 1);
  }

  if (s3Bucket) {
    const region = s3Region || 'us-east-1';
    const s3PublicUrl = `https://${s3Bucket}.s3.${region}.amazonaws.com`;
    if (value.startsWith(`${s3PublicUrl}/`)) return value.slice(s3PublicUrl.length + 1);
  }

  return null;
}

function storageKey(
  value: string,
  s3Bucket: string | null,
  s3Region: string | null
): string | null {
  const localKey = keyFromLocalUrl(value);
  if (localKey) return localKey;

  const publicUrlKey = keyFromKnownPublicUrl(value, s3Bucket, s3Region);
  if (publicUrlKey) return publicUrlKey;

  if (value.includes('://')) return null;
  if (STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))) return value;
  return null;
}

function contentTypeForKey(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function pushRef(
  refs: StorageRef[],
  id: string,
  field: string,
  value: string | null | undefined,
  update: (value: string) => Promise<unknown>
): void {
  if (!value) return;
  refs.push({ id, field, value, update });
}

async function collectStorageRefs(): Promise<StorageRef[]> {
  const refs: StorageRef[] = [];
  const [episodes, segments, versions, recordings, speakingPrompts, focusTargets, classes, users] =
    await Promise.all([
      prisma.episode.findMany({
        select: { id: true, audioUrl: true, pdfUrl: true, waveformUrl: true, spectrogramUrl: true },
      }),
      prisma.segment.findMany({ select: { id: true, audioUrl: true } }),
      prisma.episodeVersion.findMany({ select: { id: true, audioUrl: true } }),
      prisma.speakingRecording.findMany({ select: { id: true, audioUrl: true } }),
      prisma.speakingPrompt.findMany({ select: { id: true, referenceTtsUrl: true } }),
      prisma.learnerFocusTarget.findMany({
        select: { id: true, pronunciationAudioUrl: true, visualCueUrl: true },
      }),
      prisma.courseClass.findMany({ select: { id: true, worksheetPdfUrl: true } }),
      prisma.user.findMany({ select: { id: true, image: true } }),
    ]);

  for (const item of episodes) {
    pushRef(refs, item.id, 'Episode.audioUrl', item.audioUrl, (value) =>
      prisma.episode.update({ where: { id: item.id }, data: { audioUrl: value } })
    );
    pushRef(refs, item.id, 'Episode.pdfUrl', item.pdfUrl, (value) =>
      prisma.episode.update({ where: { id: item.id }, data: { pdfUrl: value } })
    );
    pushRef(refs, item.id, 'Episode.waveformUrl', item.waveformUrl, (value) =>
      prisma.episode.update({ where: { id: item.id }, data: { waveformUrl: value } })
    );
    pushRef(refs, item.id, 'Episode.spectrogramUrl', item.spectrogramUrl, (value) =>
      prisma.episode.update({ where: { id: item.id }, data: { spectrogramUrl: value } })
    );
  }

  for (const item of segments) {
    pushRef(refs, item.id, 'Segment.audioUrl', item.audioUrl, (value) =>
      prisma.segment.update({ where: { id: item.id }, data: { audioUrl: value } })
    );
  }

  for (const item of versions) {
    pushRef(refs, item.id, 'EpisodeVersion.audioUrl', item.audioUrl, (value) =>
      prisma.episodeVersion.update({ where: { id: item.id }, data: { audioUrl: value } })
    );
  }

  for (const item of recordings) {
    pushRef(refs, item.id, 'SpeakingRecording.audioUrl', item.audioUrl, (value) =>
      prisma.speakingRecording.update({ where: { id: item.id }, data: { audioUrl: value } })
    );
  }

  for (const item of speakingPrompts) {
    pushRef(refs, item.id, 'SpeakingPrompt.referenceTtsUrl', item.referenceTtsUrl, (value) =>
      prisma.speakingPrompt.update({ where: { id: item.id }, data: { referenceTtsUrl: value } })
    );
  }

  for (const item of focusTargets) {
    pushRef(
      refs,
      item.id,
      'LearnerFocusTarget.pronunciationAudioUrl',
      item.pronunciationAudioUrl,
      (value) =>
        prisma.learnerFocusTarget.update({
          where: { id: item.id },
          data: { pronunciationAudioUrl: value },
        })
    );
    pushRef(refs, item.id, 'LearnerFocusTarget.visualCueUrl', item.visualCueUrl, (value) =>
      prisma.learnerFocusTarget.update({ where: { id: item.id }, data: { visualCueUrl: value } })
    );
  }

  for (const item of classes) {
    pushRef(refs, item.id, 'CourseClass.worksheetPdfUrl', item.worksheetPdfUrl, (value) =>
      prisma.courseClass.update({ where: { id: item.id }, data: { worksheetPdfUrl: value } })
    );
  }

  for (const item of users) {
    pushRef(refs, item.id, 'User.image', item.image, (value) =>
      prisma.user.update({ where: { id: item.id }, data: { image: value } })
    );
  }

  return refs;
}

export async function migrateStorage(
  options: StorageMigrationOptions
): Promise<StorageMigrationResult> {
  const config = await getSiteConfig();
  const sourceProvider = effectiveStorageProvider(config.storageProvider);
  const source = createStorageProvider(sourceProvider, {
    s3Bucket: config.s3Bucket,
    s3Region: config.s3Region,
  });
  const target = createStorageProvider(options.targetProvider, {
    s3Bucket: options.s3Bucket,
    s3Region: options.s3Region,
  });
  const refs = await collectStorageRefs();
  const result: StorageMigrationResult = {
    sourceProvider,
    targetProvider: options.targetProvider,
    scanned: refs.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    switched: false,
    errors: [],
  };

  for (const ref of refs) {
    const key = storageKey(ref.value, config.s3Bucket, config.s3Region);
    if (!key) {
      result.skipped += 1;
      continue;
    }

    if (options.dryRun) {
      result.migrated += 1;
      continue;
    }

    try {
      const data = await source.downloadFile(key);
      const nextUrl = await target.uploadFile(key, data, contentTypeForKey(key));
      if (nextUrl !== ref.value) await ref.update(nextUrl);
      result.migrated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed += 1;
      if (result.errors.length < 10) {
        result.errors.push({ id: ref.id, field: ref.field, error: message });
      }
      logger.warn('Storage migration file failed', {
        id: ref.id,
        field: ref.field,
        key,
        error: message,
      });
    }
  }

  if (!options.dryRun && options.switchAfter && result.failed === 0) {
    await setSiteConfig(
      {
        storageProvider: options.targetProvider,
        s3Bucket: options.targetProvider === 's3' ? (options.s3Bucket ?? null) : null,
        s3Region: options.targetProvider === 's3' ? (options.s3Region ?? null) : null,
      },
      options.adminId
    );
    invalidateServerInfra();
    result.switched = true;
  }

  return result;
}
