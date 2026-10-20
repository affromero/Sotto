import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageReadCleanupError } from 'thesidedoor-core/storage';
import { prismaUnfiltered as prisma } from '../../prisma';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import { captureCourseStorage } from '../../sidedoor/storage/core/course-storage';
import {
  resolveStorageInput,
  validateStorageInputs,
} from '../../sidedoor/storage/core/storage-inputs';
import { restoreStorageBackend } from '../../r2';
import { detectAudioFormat } from '../../audio-format';
import type { SottoProviderExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import { vocabularyAudioSubject, type VocabularyAudioSubject } from './index';
import { resolveVocabularyAudio } from './provider';
import { vocabularyStudyStateSchema, VocabularyStudyUnavailable } from '../study-state';

/** Playback reads a previously published owned asset. It never synthesizes audio. */
export async function readVocabularyAudio(
  subject: VocabularyAudioSubject,
  execution: SottoProviderExecution
) {
  const source = await sottoTransaction(prisma, async (database) => {
    const actor = await execution.authorize(database);
    return vocabularyAudioSubject(database, actor.userId, subject);
  });
  const selected = await resolveVocabularyAudio(source.courseId, source.text, execution);
  const captured = await sottoTransaction(prisma, async (database) => {
    await execution.authorize(database);
    const asset = await database.vocabularyPronunciation.findUnique({
      where: {
        courseId_fingerprint: { courseId: source.courseId, fingerprint: selected.fingerprint },
      },
    });
    if (asset?.status !== 'READY' || !asset.audioUrl)
      throw new VocabularyStudyUnavailable('Prepare local pronunciation before playback.');
    const owner = await captureCourseStorage(database, source.courseId);
    if (owner.userId !== execution.userId)
      throw new VocabularyStudyUnavailable('Pronunciation ownership changed.');
    return resolveStorageInput(database, {
      consumer: `vocabulary-audio:${asset.id}:audio`,
      reference: asset.audioUrl,
    });
  });
  const directory = await mkdtemp(join(tmpdir(), 'sotto-vocabulary-audio-'));
  let cleanupUnconfirmed = false;
  try {
    const backend = await restoreStorageBackend(captured.backend.descriptor);
    const path = join(directory, 'pronunciation');
    await backend.downloadToFile(
      captured.input.key,
      path,
      execution.signal ?? new AbortController().signal
    );
    const bytes = await readFile(path);
    await sottoTransaction(prisma, async (database) => {
      await execution.authorize(database);
      const profile = await database.user.findUniqueOrThrow({
        where: { id: execution.userId },
        select: { preferredTtsProvider: true },
      });
      if (profile.preferredTtsProvider === 'disabled')
        throw new VocabularyStudyUnavailable('Audio is disabled for this profile.');
      const current = await vocabularyAudioSubject(database, execution.userId, subject);
      if (current.courseId !== source.courseId || current.text !== source.text)
        throw new VocabularyStudyUnavailable('The dictionary word changed.');
      await captureCourseStorage(database, source.courseId);
      await validateStorageInputs(database, [captured.input]);
      if ('sessionId' in subject) {
        await database.$queryRaw`SELECT id FROM "PracticeSession" WHERE id = ${subject.sessionId} FOR UPDATE`;
        const session = await database.practiceSession.findUniqueOrThrow({
          where: { id: subject.sessionId },
        });
        const state = vocabularyStudyStateSchema.parse(session.vocabularyStudy);
        const card = state.cards.find((item) => item.id === subject.cardId)!;
        if (
          state.mode === 'LISTENING_RECALL' &&
          !card.listeningPresentedAt &&
          session.status === 'ACTIVE'
        ) {
          card.listeningPresentedAt = new Date().toISOString();
          await database.practiceSession.update({
            where: { id: session.id },
            data: { vocabularyStudy: state },
          });
        }
      }
    });
    return { bytes, mime: detectAudioFormat(bytes).mime };
  } catch (error) {
    cleanupUnconfirmed = error instanceof StorageReadCleanupError;
    throw error;
  } finally {
    if (!cleanupUnconfirmed) await rm(directory, { recursive: true, force: true });
  }
}
