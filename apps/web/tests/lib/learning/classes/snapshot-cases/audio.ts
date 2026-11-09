import { expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSerializationConflict } from 'thesidedoor-core/storage/sql';
import {
  LocalStorageCleanup,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { Prisma } from '@/generated/prisma/client';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { resolveStorageInput } from '@/lib/sidedoor/storage/core/storage-inputs';
import { publishLearningAudioIdentity } from '@/lib/learning-map/evidence/audio';
import { learningScriptTranscript } from '@/lib/learning/script-hash';
import {
  assessmentListeningAudioIdentity,
  assessmentSpeakingReferenceIdentity,
} from '@/lib/learning/classes/material/assessment-audio';
import { captureEpisodeStorage } from '@/lib/sidedoor/storage/core/episode-storage';
import { captureSealedAssessmentCandidate } from '@/lib/learning/classes/material/assessment-snapshot';
import { fenceAssessmentStorageInputs } from '@/lib/learning/classes/lifecycle/assessment-storage-fence';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import { relocateStorageFixture } from '../../../../helpers/runtime/relocate-storage';
import {
  readStorageConsumerReference,
  replaceStorageConsumerReference,
} from '@/lib/sidedoor/storage/core/storage-consumers';
import { visitStorageDeletionReferences } from '@/lib/storage/sidedoor/deletion-targets';
import { readStorageMigrationReferencePage } from '@/lib/sidedoor/storage/migration/storage-migration-references';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import type { SnapshotContext } from './context';

export function registerSnapshotAudioCases(getContext: () => SnapshotContext) {
  it('captures all five skills with registered audio identities and rejects changed sources', async () => {
    const { instance, ownerId, ownerToken, classId, fixture } = getContext();
    const { saved, expected, capture } = await fixture(true, true);
    expect(await capture()).toEqual({ status: 'PREPARING_AUDIO' });
    const root = await mkdtemp(join(tmpdir(), 'sotto-assessment-audio-'));
    try {
      const backend = await capturedLocalBackend(
        await LocalStorageCleanup.capture(root),
        root,
        LOCAL_STORAGE_URL_PREFIX,
        () => {}
      );
      const registration = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      const put = async (consumer: string, bytes: Buffer, episodeId?: string) => {
        const key = `${randomUUID()}.wav`;
        const reference = await backend.writeBuffer(key, bytes, 'audio/wav');
        return sottoTransaction(instance.database, async (tx) => {
          const executor = {
            query: (sql: string, values: readonly unknown[]) =>
              tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
          };
          await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
            registration
          );
          const episodeScopes = episodeId
            ? (await captureEpisodeStorage(tx, episodeId)).scopes
            : [];
          const scopes = [...expected.ownership.scopes];
          for (const scope of episodeScopes) {
            const existing = scopes.find((entry) => entry.subjectId === scope.subjectId);
            if (existing && existing.generation !== scope.generation)
              throw new Error('Fixture storage scope changed');
            if (!existing) scopes.push(scope);
          }
          await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
            consumers: [{ consumer, previousReference: null }],
            next: prepareStorageReference({
              namespace: SIDEDOOR_STATE_ID,
              operationId: randomUUID(),
              reference,
              localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
              target: { backendId: registration.id, binding: registration.binding, key },
              scopes,
            }),
          });
          return (await resolveStorageInput(tx, { consumer, reference })).input;
        });
      };
      const section = await instance.database.classAssessmentSection.findFirstOrThrow({
        where: { assessmentId: saved.id, skill: 'LISTENING' },
      });
      const episodeId = section.episodeId!;
      const turns = [{ speaker: 'HOST', text: 'Привет', direction: 'calm' }];
      const audioBytes = Buffer.from('ID3assessment listening audio');
      const audio = await put(`episode:${episodeId}:audio`, audioBytes, episodeId);
      await instance.database.script.create({
        data: { episodeId, turns, markdown: 'HOST: Привет' },
      });
      for (let index = 0; index < 4; index += 1)
        await instance.database.classAssessmentQuestion.create({
          data: {
            assessmentId: saved.id,
            sectionId: section.id,
            order: index,
            question: `Listen ${index}`,
            options: ['a', 'b', 'c', 'd'],
            correctIndex: 0,
            explanation: 'Reason',
          },
        });
      await instance.database.episode.update({
        where: { id: episodeId },
        data: {
          status: 'READY',
          source: 'CLASS',
          audioUrl: audio.reference,
          audioGenerationKey: 'assessment-audio-generation',
        },
      });
      const identity = await sottoTransaction(instance.database, (tx) =>
        publishLearningAudioIdentity(tx, {
          episodeId,
          audioUrl: audio.reference,
          contentSha256: createHash('sha256').update(audioBytes).digest('hex'),
          contentBytes: audioBytes.length,
          version: 1,
        })
      );
      if (!identity) throw new Error('Audio identity fixture unavailable');
      await instance.database.classAssessmentSection.update({
        where: { id: section.id },
        data: { audioIdentity: identity as Prisma.InputJsonValue },
      });
      const prompts = await instance.database.speakingPrompt.findMany({
        where: { assessmentSection: { assessmentId: saved.id } },
      });
      for (const prompt of prompts) {
        const bytes = Buffer.from(`ID3assessment reference ${prompt.id}`);
        const reference = await put(`speaking-prompt:${prompt.id}:reference`, bytes);
        await instance.database.speakingPrompt.update({
          where: { id: prompt.id },
          data: {
            referenceTtsUrl: reference.reference,
            assessmentReferenceIdentity: {
              version: 1,
              assessmentId: saved.id,
              promptId: prompt.id,
              userId: ownerId,
              contentSha256: createHash('sha256').update(bytes).digest('hex'),
              contentBytes: bytes.length,
              reference,
            },
          },
        });
      }
      const result = await capture();
      expect(result.status).toBe('CAPTURED');
      if (result.status !== 'CAPTURED') throw new Error('candidate fixture');
      const referencePrompt = prompts[0]!;
      const originalPrompt = await instance.database.speakingPrompt.findUniqueOrThrow({
        where: { id: referencePrompt.id },
        include: { assessmentReference: true },
      });
      if (!originalPrompt.referenceTtsUrl || !originalPrompt.assessmentReference)
        throw new Error('Speaking reference fixture missing');
      const consumer = `speaking-prompt:${referencePrompt.id}:reference`;
      await expect(
        sottoTransaction(instance.database, async (tx) => {
          await tx.episode.update({
            where: { id: episodeId },
            data: { lastCompletedStitchKey: 'fixture-stitch' },
          });
          await tx.classAssessment.update({
            where: { id: saved.id },
            data: {
              status: 'READY',
              reviewOperationId: 'fixture-review',
              reviewedMaterialDigest: result.digest,
              reviewReceipt: {},
              sealedAt: new Date(),
            },
          });
          const read = () =>
            captureSealedAssessmentCandidate(tx, authorizedLearnerExecution(ownerId), expected);
          const initial = await read();
          expect(initial).toMatchObject({ status: 'CAPTURED', digest: result.digest });
          if (initial.status !== 'CAPTURED') throw new Error('Sealed audio fixture missing');
          expect(initial.audioSources).toContainEqual(
            expect.objectContaining({
              kind: 'LISTENING',
              sectionId: section.id,
              currentReference: audio.reference,
              contentSha256: createHash('sha256').update(audioBytes).digest('hex'),
              contentBytes: audioBytes.length,
            })
          );
          const expectedSpeaking = initial.audioSources.find(
            (source) => source.kind === 'SPEAKING' && source.promptId === referencePrompt.id
          );
          if (!expectedSpeaking) throw new Error('Speaking audio fixture missing');
          expect(expectedSpeaking).toMatchObject({
            currentReference: originalPrompt.referenceTtsUrl,
          });
          const moved = await relocateStorageFixture({
            database: instance.database,
            transaction: tx,
            backend,
            directory: root,
            reference: originalPrompt.referenceTtsUrl!,
            consumers: [consumer],
            publish: (database, reference) =>
              replaceStorageConsumerReference(
                database,
                consumer,
                originalPrompt.referenceTtsUrl!,
                reference
              ),
          });
          expect(await readStorageConsumerReference(tx, consumer)).toBe(moved);
          expect(
            (await tx.speakingPrompt.findUniqueOrThrow({ where: { id: referencePrompt.id } }))
              .referenceTtsUrl
          ).toBe(originalPrompt.referenceTtsUrl);
          const relocated = await read();
          expect(relocated).toMatchObject({ status: 'CAPTURED', digest: result.digest });
          if (relocated.status !== 'CAPTURED') throw new Error('Relocated audio fixture missing');
          expect(relocated.audioSources).toContainEqual({
            ...expectedSpeaking,
            currentReference: moved,
          });
          const movedAgain = await relocateStorageFixture({
            database: instance.database,
            transaction: tx,
            backend,
            directory: root,
            reference: moved,
            consumers: [consumer],
            publish: (database, reference) =>
              replaceStorageConsumerReference(database, consumer, moved, reference),
          });
          const relocatedAgain = await read();
          expect(relocatedAgain).toMatchObject({ status: 'CAPTURED', digest: result.digest });
          if (relocatedAgain.status !== 'CAPTURED')
            throw new Error('Relocated audio fixture missing');
          expect(relocatedAgain.audioSources).toContainEqual({
            ...expectedSpeaking,
            currentReference: movedAgain,
          });
          const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
            headers: { cookie: `${SHARED_SESSION_COOKIE}=${ownerToken}` },
          });
          const admission = await resolveSottoRequest(tx, request);
          if (!admission || admission.kind !== 'content') throw new Error('Owner session missing');
          const inventory = await readStorageMigrationReferencePage({
            database: tx,
            request,
            admission,
          });
          expect(inventory.references.filter((entry) => entry.consumer === consumer)).toEqual([
            expect.objectContaining({ reference: movedAgain, attribution: 'registered' }),
          ]);
          const pages: Array<{ id: string; references: Record<string, string> }> = [];
          await visitStorageDeletionReferences(
            tx,
            { kind: 'class', id: classId, episodeIds: [episodeId] },
            async (page) => {
              if (page.source === 'prompt') pages.push(...page.rows);
            }
          );
          expect(
            pages.find((item) => item.id === referencePrompt.id)?.references.referenceTtsUrl
          ).toBe(movedAgain);
          await tx.assessmentSpeakingReference.update({
            where: { promptId: referencePrompt.id },
            data: { currentUrl: '/unproved-reference' },
          });
          await expect(read()).rejects.toThrow();
          await tx.assessmentSpeakingReference.delete({ where: { promptId: referencePrompt.id } });
          await expect(read()).rejects.toThrow('Assessment speaking reference changed');
          await expect(readStorageConsumerReference(tx, consumer)).rejects.toThrow(
            'Assessment speaking locator is inconsistent'
          );
          throw new Error('Roll back speaking relocation fixture');
        })
      ).rejects.toThrow('Roll back speaking relocation fixture');
      const registryRows = await instance.database.$queryRaw<{ id: string; kind: string }[]>`
        SELECT id, state->>'kind' AS kind FROM "SidedoorState"
        WHERE (state->>'kind' = 'storage_reference_alias' AND state->>'reference' = ${audio.reference})
           OR (state->>'kind' = 'storage_asset' AND state->>'id' = ${audio.assetId})
           OR (state->>'kind' = 'storage_backend' AND state->>'id' = ${audio.backendId})`;
      expect(registryRows.map((row) => row.kind).sort()).toEqual([
        'storage_asset',
        'storage_backend',
        'storage_reference_alias',
      ]);
      for (const row of registryRows) {
        let resume!: () => void;
        let started!: () => void;
        const gate = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const reading = instance.database.$transaction(
          async (tx) => {
            await tx.courseClass.findUniqueOrThrow({
              where: { id: classId },
              select: { id: true },
            });
            started();
            await gate;
            await fenceAssessmentStorageInputs(tx, [audio]);
          },
          { isolationLevel: 'Serializable', timeout: 15000 }
        );
        await ready;
        try {
          await instance.database
            .$executeRaw`UPDATE "SidedoorState" SET revision = revision WHERE id = ${row.id}`;
        } finally {
          resume();
        }
        const error = await reading.then(
          () => null,
          (cause: unknown) => cause
        );
        expect(isSerializationConflict(error), row.kind).toBe(true);
      }
      const assetRow = registryRows.find((row) => row.kind === 'storage_asset');
      if (!assetRow) throw new Error('Assessment storage asset missing');
      let releaseDeadlock!: () => void;
      let classLocked!: () => void;
      let assetLocked!: () => void;
      const deadlockGate = new Promise<void>((resolve) => {
        releaseDeadlock = resolve;
      });
      const classReady = new Promise<void>((resolve) => {
        classLocked = resolve;
      });
      const assetReady = new Promise<void>((resolve) => {
        assetLocked = resolve;
      });
      let candidateAttempts = 0;
      let writerAttempts = 0;
      const candidate = sottoTransaction(instance.database, async (tx) => {
        candidateAttempts += 1;
        await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
        if (candidateAttempts === 1) {
          classLocked();
          await deadlockGate;
        }
        await fenceAssessmentStorageInputs(tx, [audio]);
      });
      const writer = sottoTransaction(instance.database, async (tx) => {
        writerAttempts += 1;
        await tx.$queryRaw`SELECT id FROM "SidedoorState" WHERE id = ${assetRow.id} FOR UPDATE`;
        if (writerAttempts === 1) {
          assetLocked();
          await deadlockGate;
        }
        await tx.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${classId} FOR UPDATE`;
      });
      try {
        await Promise.race([
          Promise.all([classReady, assetReady]),
          candidate.then(() => {
            throw new Error('Candidate ended before both locks were held');
          }),
          writer.then(() => {
            throw new Error('Writer ended before both locks were held');
          }),
        ]);
      } finally {
        releaseDeadlock();
      }
      await Promise.all([candidate, writer]);
      expect(candidateAttempts + writerAttempts).toBeGreaterThan(2);
      expect(result.material.sections.map((item) => item.skill)).toEqual([
        'GRAMMAR',
        'READING',
        'LISTENING',
        'SPEAKING',
        'WRITING',
      ]);
      const listening = result.material.sections.find((item) => item.skill === 'LISTENING');
      if (!listening || listening.skill !== 'LISTENING')
        throw new Error('listening candidate missing');
      expect(listening.audio).toEqual({
        episodeId,
        privateTranscript: learningScriptTranscript(turns),
        mediaIdentity: assessmentListeningAudioIdentity(identity, {
          episodeId,
          userId: ownerId,
          turns,
        }),
      });
      const speaking = result.material.sections.find((item) => item.skill === 'SPEAKING');
      await expect(
        instance.database.script.update({
          where: { episodeId },
          data: {
            soundCues: [
              {
                type: 'effect',
                prompt: 'Unreviewed sound',
                durationSeconds: 1,
                insertAfterTurn: 0,
              },
            ],
          },
        })
      ).rejects.toThrow(/frozen by admitted audio/);
      expect(speaking?.items).toHaveLength(4);
      expect(speaking?.items[0]).toMatchObject({
        mode: 'READ_ALOUD',
        privateGuidance: expect.stringContaining('Palabra'),
        referenceAudioId: expect.any(String),
      });
      const storedPrompts = await instance.database.speakingPrompt.findMany({
        where: { assessmentSection: { assessmentId: saved.id } },
      });
      for (const prompt of storedPrompts) {
        const item = speaking?.items.find((candidate) => candidate.id === prompt.id);
        expect(item).toMatchObject({
          referenceAudioId: assessmentSpeakingReferenceIdentity(
            prompt.assessmentReferenceIdentity,
            { assessmentId: saved.id, promptId: prompt.id, userId: ownerId }
          ),
        });
      }
      const changedPrompt = storedPrompts[0]!;
      await expect(
        instance.database.speakingPrompt.update({
          where: { id: changedPrompt.id },
          data: {
            assessmentTaskMode: 'COMMUNICATIVE',
            referenceTtsUrl: null,
            assessmentReferenceIdentity: Prisma.DbNull,
          },
        })
      ).rejects.toThrow(/frozen by admitted audio/);
      await expect(
        instance.database.script.update({
          where: { episodeId },
          data: { turns: [{ speaker: 'HOST', text: 'Пока' }] },
        })
      ).rejects.toThrow(/frozen by admitted audio/);
      expect((await capture()).status).toBe('CAPTURED');
      const replacementKey = `${randomUUID()}.wav`;
      const replacement = await backend.writeBuffer(
        replacementKey,
        Buffer.from('replacement audio'),
        'audio/wav'
      );
      await expect(
        instance.database.$transaction((tx) => fenceAssessmentStorageInputs(tx, [audio]))
      ).rejects.toThrow('Assessment storage requires a Serializable transaction');
      let resumeStale!: () => void;
      let staleStarted!: () => void;
      const staleGate = new Promise<void>((resolve) => {
        resumeStale = resolve;
      });
      const staleReady = new Promise<void>((resolve) => {
        staleStarted = resolve;
      });
      const stale = instance.database.$transaction(
        async (tx) => {
          await tx.courseClass.findUniqueOrThrow({ where: { id: classId }, select: { id: true } });
          staleStarted();
          await staleGate;
          await fenceAssessmentStorageInputs(tx, [audio]);
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      await staleReady;
      let releaseFence!: () => void;
      let fenceStarted!: () => void;
      const fenceGate = new Promise<void>((resolve) => {
        releaseFence = resolve;
      });
      const fenceReady = new Promise<void>((resolve) => {
        fenceStarted = resolve;
      });
      const fenced = instance.database.$transaction(
        async (tx) => {
          await fenceAssessmentStorageInputs(tx, [audio]);
          fenceStarted();
          await fenceGate;
        },
        { isolationLevel: 'Serializable', timeout: 15000 }
      );
      try {
        await Promise.race([
          fenceReady,
          fenced.then(() => {
            throw new Error('Storage fence ended before signaling readiness');
          }),
        ]);
      } catch (error) {
        releaseFence();
        resumeStale();
        await stale.catch(() => {});
        throw error;
      }
      const replacing = sottoTransaction(instance.database, async (tx) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
          consumers: [
            { consumer: `episode:${episodeId}:audio`, previousReference: audio.reference },
          ],
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: replacement,
            localRoutePrefix: LOCAL_STORAGE_URL_PREFIX,
            target: {
              backendId: registration.id,
              binding: registration.binding,
              key: replacementKey,
            },
            scopes: (await captureEpisodeStorage(tx, episodeId)).scopes,
          }),
        });
      });
      try {
        expect(
          await Promise.race([
            replacing.then(() => 'replaced'),
            new Promise((resolve) => setTimeout(() => resolve('waiting'), 50)),
          ])
        ).toBe('waiting');
        releaseFence();
        await fenced;
        await replacing;
        resumeStale();
        const staleError = await stale.then(
          () => null,
          (error: unknown) => error
        );
        expect(isSerializationConflict(staleError)).toBe(true);
      } finally {
        releaseFence();
        resumeStale();
      }
      await expect(capture()).rejects.toThrow(/does not belong to this consumer/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
