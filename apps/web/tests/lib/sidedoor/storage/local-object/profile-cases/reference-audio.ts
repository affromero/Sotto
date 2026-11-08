import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import {
  StorageBackendRegistry,
  StorageReferenceRegistry,
  prepareStorageBackend,
  prepareStorageReference,
} from 'thesidedoor-core/storage';
import { captureStorageBackend } from '@/lib/r2';
import * as storageRuntime from '@/lib/r2';
import {
  encryptSpeakingReference,
  speakingReferenceWrappingKey,
  SPEAKING_REFERENCE_CHUNK_BYTES,
} from '@/lib/classes/speaking/speaking-reference-crypto';
import { SIDEDOOR_STATE_ID, sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../helpers/setup/shared-instance';

interface ReferenceAudioContext {
  instance: SharedTestInstance;
  identity: SharedTestIdentity;
  directory: string;
  learnerId: string;
  otherId: string;
  courseId: string;
  classId: string;
  boundary: { userId: string | null };
  getReferenceAudio: typeof import('@/app/api/v1/classes/[classId]/speaking/[promptId]/reference/audio/route').GET;
  speakingSection: () => Promise<{ id: string; incarnationId: string; attempt: number }>;
}

export function registerReferenceAudioCase(getContext: () => ReferenceAudioContext) {
  it('plays encrypted references only for the owning learner, including ranges across chunks', async () => {
    const {
      instance,
      identity,
      directory,
      learnerId,
      otherId,
      courseId,
      classId,
      boundary,
      getReferenceAudio,
      speakingSection,
    } = getContext();
    vi.stubEnv('BYOK_ENCRYPTION_KEY', 'test-reference-instance-secret');
    try {
      const section = await speakingSection();
      const prompt = await instance.database.speakingPrompt.create({
        data: { sectionId: section.id, order: 1, targetPhrase: 'Hola', translation: 'Hello' },
      });
      const cls = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: classId },
        include: { course: { include: { user: true } } },
      });
      const storageInstance = await sottoStorageInstance(instance.database).read();
      const binding = {
        instanceId: storageInstance.instanceId,
        userId: learnerId,
        userCreatedAt: cls.course.user.createdAt.getTime(),
        courseId,
        courseCreatedAt: cls.course.createdAt.getTime(),
        classId,
        classCreatedAt: cls.createdAt.getTime(),
        sectionId: section.id,
        sectionIncarnationId: section.incarnationId,
        promptId: prompt.id,
        promptIncarnationId: prompt.incarnationId,
        attempt: section.attempt,
        operationId: randomUUID(),
        sourceHash: 'a'.repeat(64),
      };
      const plain = Buffer.concat([
        Buffer.alloc(SPEAKING_REFERENCE_CHUNK_BYTES, 65),
        Buffer.from('last bytes'),
      ]);
      const wrappingKey = speakingReferenceWrappingKey();
      const encrypted = encryptSpeakingReference(plain, binding, wrappingKey);
      wrappingKey.fill(0);
      const backend = await captureStorageBackend();
      const audioKey = `speaking-reference/${randomUUID()}.bin`;
      const audioReference = await backend.writeBuffer(
        audioKey,
        encrypted.ciphertext,
        'application/octet-stream'
      );
      await instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceTtsUrl: audioReference, referenceEncryption: encrypted.envelope },
      });
      await sottoTransaction(instance.database, async (database) => {
        const executor = {
          query: (sql: string, values: readonly unknown[]) =>
            database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
        };
        const stored = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
        await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(stored);
        await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
          consumers: [
            { consumer: `speaking-prompt:${prompt.id}:reference`, previousReference: null },
          ],
          next: prepareStorageReference({
            namespace: SIDEDOOR_STATE_ID,
            operationId: randomUUID(),
            reference: audioReference,
            localRoutePrefix: '/api/v1/storage',
            target: { backendId: stored.id, binding: stored.binding, key: audioKey },
            scopes: [
              { subjectId: `course:${courseId}`, generation: cls.course.createdAt.getTime() },
            ],
          }),
        });
      });
      const download = (userId: string, range?: string) => {
        boundary.userId = userId;
        return getReferenceAudio(
          new NextRequest('http://localhost/audio', { headers: range ? { range } : undefined }),
          { params: Promise.resolve({ classId, promptId: prompt.id }) }
        );
      };
      expect((await download(learnerId)).status).toBe(409);
      await instance.database.courseClass.create({
        data: {
          courseId,
          lessonId: cls.lessonId,
          order: 0,
          status: 'PASSED',
          createdAt: new Date(cls.createdAt.getTime() - 1000),
        },
      });
      const full = await download(learnerId);
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('audio/mpeg');
      expect(Buffer.from(await full.arrayBuffer())).toEqual(plain);
      const nextKey = randomBytes(32);
      const rotated = encryptSpeakingReference(plain, binding, nextKey);
      vi.stubEnv(
        'SOTTO_SPEAKING_REFERENCE_KEYRING',
        JSON.stringify({
          version: 1,
          active: rotated.envelope.keyId,
          keys: [nextKey.toString('hex')],
        })
      );
      expect(Buffer.from(await (await download(learnerId)).arrayBuffer())).toEqual(plain);
      await writeFile(join(directory, audioKey), rotated.ciphertext);
      await instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceEncryption: rotated.envelope },
      });
      expect(Buffer.from(await (await download(learnerId)).arrayBuffer())).toEqual(plain);
      vi.stubEnv(
        'SOTTO_SPEAKING_REFERENCE_KEYRING',
        JSON.stringify({ version: 1, active: 'legacy', keys: [nextKey.toString('hex')] })
      );
      expect(Buffer.from(await (await download(learnerId)).arrayBuffer())).toEqual(plain);
      await writeFile(join(directory, audioKey), encrypted.ciphertext);
      await instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceEncryption: encrypted.envelope },
      });
      nextKey.fill(0);
      const invalidTag = Buffer.from(encrypted.envelope.wrapTag, 'base64');
      invalidTag[0] = invalidTag[0]! ^ 1;
      await instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: {
          referenceEncryption: { ...encrypted.envelope, wrapTag: invalidTag.toString('base64') },
        },
      });
      expect((await download(learnerId)).status).toBe(502);
      await instance.database.speakingPrompt.update({
        where: { id: prompt.id },
        data: { referenceEncryption: encrypted.envelope },
      });
      const start = SPEAKING_REFERENCE_CHUNK_BYTES - 2;
      const partial = await download(learnerId, `bytes=${start}-${start + 4}`);
      expect(partial.status).toBe(206);
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(plain.subarray(start, start + 5));
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'PASSED' },
      });
      const replay = await download(learnerId);
      expect(replay.status).toBe(200);
      expect(Buffer.from(await replay.arrayBuffer())).toEqual(plain);
      await instance.database.courseClass.update({
        where: { id: classId },
        data: { status: 'AVAILABLE' },
      });
      expect((await download(otherId)).status).toBe(404);
      expect((await download(identity.ownerId)).status).toBe(404);
      const newer = await instance.database.classSection.create({
        data: {
          classId,
          skill: 'SPEAKING',
          attempt: section.attempt + 1,
          seed: 'newer',
          spec: {},
        },
      });
      expect((await download(learnerId)).status).toBe(404);
      await instance.database.classSection.delete({ where: { id: newer.id } });
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const readRange = storageRuntime.readAttributedStorageRange;
      const spy = vi
        .spyOn(storageRuntime, 'readAttributedStorageRange')
        .mockImplementation(async (options) => {
          if (options.start === SPEAKING_REFERENCE_CHUNK_BYTES + 16) {
            entered();
            await gate;
          }
          return readRange(options);
        });
      try {
        const interrupted = await download(learnerId);
        const reader = interrupted.body!.getReader();
        expect((await reader.read()).value?.length).toBe(SPEAKING_REFERENCE_CHUNK_BYTES);
        await Promise.race([
          waiting,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Second reference range did not start')), 2000)
          ),
        ]);
        await instance.database.classSection.update({
          where: { id: section.id },
          data: { withdrawn: true },
        });
        release();
        await expect(reader.read()).rejects.toThrow('Storage consumer is not authorized');
      } finally {
        release();
        spy.mockRestore();
        await instance.database.classSection.update({
          where: { id: section.id },
          data: { withdrawn: false },
        });
      }
      await instance.database.classSection.update({
        where: { id: section.id },
        data: { withdrawn: true },
      });
      expect((await download(learnerId)).status).toBe(404);
      await instance.database.classSection.update({
        where: { id: section.id },
        data: { withdrawn: false },
      });
      const corrupted = Buffer.from(encrypted.ciphertext);
      corrupted[0] = corrupted[0]! ^ 1;
      await writeFile(join(directory, audioKey), corrupted);
      const damaged = await download(learnerId);
      await expect(damaged.arrayBuffer()).rejects.toThrow(
        'Speaking reference authentication failed'
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
}
