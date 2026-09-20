import { AccessError } from 'thesidedoor-core/access';
import {
  StorageReferenceRegistry,
  StorageWriteJournal,
  type PreparedStorageReference,
} from 'thesidedoor-core/storage';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import {
  captureEpisodeStorage,
  EpisodeStorageChangedError,
} from '@/lib/sidedoor/storage/core/episode-storage';
import {
  captureCourseStorage,
  CourseStorageChangedError,
} from '@/lib/sidedoor/storage/core/course-storage';
import {
  captureSpeakingPromptStorage,
  captureSpeakingRecordingStorage,
  SpeakingStorageChangedError,
} from '@/lib/sidedoor/storage/core/speaking-storage';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';

type Scope = { subjectId: string; generation: number };
type ConsumerState = { reference: string | null; scopes: Scope[]; associations?: Prisma.JsonValue };

/** Application ownership and reference fields, read in the inventory transaction. */
async function currentConsumer(
  database: Prisma.TransactionClient,
  consumer: string
): Promise<ConsumerState | null> {
  const parts = consumer.split(':');
  if (parts.length !== 3) return null;
  const [kind, id, slot] = parts;
  if (!id) return null;
  if (kind === 'profile' && slot === 'avatar') {
    const profile = await database.user.findUnique({
      where: { id },
      select: { image: true, createdAt: true },
    });
    if (!profile) return { reference: null, scopes: [] };
    const instance = await sottoStorageInstance(database).read();
    return {
      reference: profile.image,
      scopes: [
        { subjectId: instance.subjectId, generation: instance.generation },
        { subjectId: `profile:${id}`, generation: profile.createdAt.getTime() },
      ],
    };
  }
  if (kind === 'episode') {
    const fields = new Map<string, 'audioUrl' | 'pdfUrl' | 'waveformUrl' | 'spectrogramUrl'>([
      ['audio', 'audioUrl'],
      ['transcript', 'pdfUrl'],
      ['waveform', 'waveformUrl'],
      ['spectrogram', 'spectrogramUrl'],
    ]);
    const field = fields.get(slot!);
    if (!field) return null;
    const episode = await database.episode.findUnique({
      where: { id },
      select: {
        audioUrl: true,
        pdfUrl: true,
        waveformUrl: true,
        spectrogramUrl: true,
        deletedAt: true,
      },
    });
    if (!episode || episode.deletedAt) return { reference: null, scopes: [] };
    return { reference: episode[field], ...(await captureEpisodeStorage(database, id)) };
  }
  if (kind === 'segment' && slot === 'audio') {
    const segment = await database.segment.findUnique({
      where: { id },
      select: { audioUrl: true, episodeId: true },
    });
    if (!segment) return { reference: null, scopes: [] };
    return {
      reference: segment.audioUrl,
      ...(await captureEpisodeStorage(database, segment.episodeId)),
    };
  }
  if (kind === 'episode-version' && slot === 'audio') {
    const version = await database.episodeVersion.findUnique({
      where: { id },
      select: { audioUrl: true, episodeId: true },
    });
    if (!version) return { reference: null, scopes: [] };
    return {
      reference: version.audioUrl,
      ...(await captureEpisodeStorage(database, version.episodeId)),
    };
  }
  if (kind === 'class' && slot === 'worksheet') {
    const item = await database.courseClass.findUnique({
      where: { id },
      select: { worksheetPdfUrl: true, courseId: true },
    });
    if (!item) return { reference: null, scopes: [] };
    return {
      reference: item.worksheetPdfUrl,
      scopes: (await captureCourseStorage(database, item.courseId)).scopes,
    };
  }
  if (kind === 'focus-target' && (slot === 'pronunciation' || slot === 'visual')) {
    const item = await database.learnerFocusTarget.findUnique({
      where: { id },
      select: {
        pronunciationAudioUrl: true,
        visualCueUrl: true,
        courseId: true,
      },
    });
    if (!item) return { reference: null, scopes: [] };
    return {
      reference: slot === 'visual' ? item.visualCueUrl : item.pronunciationAudioUrl,
      scopes: (await captureCourseStorage(database, item.courseId)).scopes,
    };
  }
  if (kind === 'speaking-prompt' && slot === 'reference') {
    if (!(await database.speakingPrompt.findUnique({ where: { id }, select: { id: true } })))
      return { reference: null, scopes: [] };
    return captureSpeakingPromptStorage(database, id);
  }
  if (kind === 'recording' && slot === 'audio') {
    if (!(await database.speakingRecording.findUnique({ where: { id }, select: { id: true } })))
      return { reference: null, scopes: [] };
    return captureSpeakingRecordingStorage(database, id);
  }
  return null;
}

export interface StorageMigrationIssue {
  assetId: string;
  consumer: string;
  reason: 'unsupported-consumer' | 'stale-reference' | 'ownership-changed';
}

/** Reused by both inventory passes; registry attribution must already be validated. */
export async function inspectStorageMigrationConsumer(
  database: Prisma.TransactionClient,
  consumer: string,
  prepared: PreparedStorageReference
) {
  let current: ConsumerState | null;
  try {
    current = await currentConsumer(database, consumer);
  } catch (error) {
    if (
      !(error instanceof EpisodeStorageChangedError) &&
      !(error instanceof CourseStorageChangedError) &&
      !(error instanceof SpeakingStorageChangedError)
    )
      throw error;
    return { reason: 'ownership-changed' as const, requiredScopes: [], requiredAssociations: null };
  }
  if (!current)
    return {
      reason: 'unsupported-consumer' as const,
      requiredScopes: [],
      requiredAssociations: null,
    };
  const required = {
    requiredScopes: current.scopes,
    requiredAssociations: current.associations ?? null,
  };
  if (current.reference !== prepared.reference)
    return { reason: 'stale-reference' as const, ...required };
  const writes = new StorageWriteJournal(
    {
      query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
    },
    'postgres',
    SIDEDOOR_STATE_ID
  );
  for (const scope of prepared.scopes)
    if (await writes.tombstone(scope.subjectId))
      return { reason: 'ownership-changed' as const, ...required };
  for (const scope of current.scopes)
    if (
      !prepared.scopes.some(
        (saved) => saved.subjectId === scope.subjectId && saved.generation === scope.generation
      )
    )
      return { reason: 'ownership-changed' as const, ...required };
  return { reason: null, ...required };
}

/**
 * One bounded, read-only page in the caller's Serializable transaction.
 * This is observational inventory. Publication must revalidate every consumer.
 * Application references without registry rows require the separate application scan.
 */
export async function readStorageMigrationAssetPage(options: {
  database: Prisma.TransactionClient;
  request: Request;
  admission: AuthenticatedRequest;
  after?: string | null;
}) {
  const { database, request, admission } = options;
  request.signal.throwIfAborted();
  if (!admission.isOwner) throw new AccessError('forbidden');
  await requireOriginalSottoAdmission(database, request, admission);
  const executor = {
    query: (sql: string, values: readonly unknown[]) =>
      database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
  };
  const registry = new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
  const page = await registry.listAssets(options.after ?? null);
  const entries: Array<{
    assetId: string;
    source: NonNullable<Awaited<ReturnType<StorageReferenceRegistry['resolve']>>>;
    claims: Array<{
      consumer: string;
      previousReference: string;
      requiredScopes: Scope[];
      requiredAssociations: Prisma.JsonValue;
    }>;
  }> = [];
  const issues: StorageMigrationIssue[] = [];
  for (const asset of page.assets) {
    request.signal.throwIfAborted();
    if (!asset.consumers.length) continue;
    const claims = [];
    let rejected = false;
    for (const consumer of asset.consumers) {
      request.signal.throwIfAborted();
      const { reason, requiredScopes, requiredAssociations } =
        await inspectStorageMigrationConsumer(database, consumer, asset.prepared);
      if (reason) {
        issues.push({ assetId: asset.id, consumer, reason });
        rejected = true;
        continue;
      }
      claims.push({
        consumer,
        previousReference: asset.prepared.reference,
        requiredScopes,
        requiredAssociations,
      });
    }
    if (rejected) continue;
    const source = await registry.resolve({
      consumer: claims[0]!.consumer,
      reference: asset.prepared.reference,
    });
    if (!source || source.assetId !== asset.id)
      throw new Error('Storage inventory attribution changed');
    entries.push({ assetId: asset.id, source, claims });
  }
  request.signal.throwIfAborted();
  return structuredClone({ entries, issues, cursor: page.cursor });
}
