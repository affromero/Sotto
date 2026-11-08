import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { publishSpeakingPromptReferences } from '@/lib/class-speaking-generator';
import { captureSpeakingPromptStorage } from '@/lib/sidedoor/storage/core/speaking-storage';
import type { StorageReferenceAdmission } from '@/lib/sidedoor/storage/core/storage-write';
import {
  decryptSpeakingReferenceChunk,
  speakingReferenceWrappingKey,
  type SpeakingReferenceBinding,
  type SpeakingReferenceEnvelope,
} from '@/lib/classes/speaking/speaking-reference-crypto';
import { authorizedLearnerExecution } from '../../../helpers/runtime/provider-execution';

export function registerSpeakingReferencePublicationCases(
  mockWriteStorageReference: ReturnType<typeof vi.fn>
) {
  describe('speaking reference publication', () => {
    it('stores encrypted repair audio and commits its exact envelope', async () => {
      const binding: SpeakingReferenceBinding = {
        instanceId: '00000000-0000-4000-8000-000000000001',
        userId: 'u1',
        userCreatedAt: 1,
        courseId: 'course-1',
        courseCreatedAt: 2,
        classId: 'class-1',
        classCreatedAt: 3,
        sectionId: 'section-1',
        sectionIncarnationId: '00000000-0000-4000-8000-000000000002',
        promptId: 'prompt-1',
        promptIncarnationId: '00000000-0000-4000-8000-000000000003',
        attempt: 1,
        operationId: '00000000-0000-4000-8000-000000000004',
        sourceHash: 'a'.repeat(64),
      };
      const snapshot = {
        instanceId: binding.instanceId,
        scopes: [{ subjectId: 'profile:u1', generation: 1 }],
        reference: null as string | null,
        associations: { promptId: 'prompt-1', createdAt: 1, parents: [] },
      };
      vi.mocked(captureSpeakingPromptStorage)
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, reference: 'stored-reference' });
      let storedEnvelope: SpeakingReferenceEnvelope | undefined;
      let storedAudio: Uint8Array | undefined;
      const database = {
        $queryRaw: async () => [],
        courseClass: {
          findUnique: async () => ({ status: 'GENERATING', attempt: 1, course: { userId: 'u1' } }),
        },
        speakingPrompt: {
          update: async ({
            data,
          }: {
            data: { referenceEncryption: SpeakingReferenceEnvelope };
          }) => {
            storedEnvelope = data.referenceEncryption;
          },
          findUnique: async () => ({ referenceEncryption: storedEnvelope }),
        },
      } as unknown as Prisma.TransactionClient;
      mockWriteStorageReference.mockImplementationOnce(
        async (options: {
          body: Uint8Array;
          captureAdmission: (
            tx: Prisma.TransactionClient
          ) => Promise<StorageReferenceAdmission<unknown>>;
          validateAdmission: (
            tx: Prisma.TransactionClient,
            admission: StorageReferenceAdmission<unknown>,
            reference?: string
          ) => Promise<void>;
          commit: (tx: Prisma.TransactionClient, reference: string) => Promise<void>;
        }) => {
          storedAudio = options.body;
          const admission = await options.captureAdmission(database);
          await options.validateAdmission(database, admission);
          await options.commit(database, 'stored-reference');
          await options.validateAdmission(database, admission, 'stored-reference');
          return 'stored-reference';
        }
      );
      vi.stubEnv('BYOK_ENCRYPTION_KEY', 'test-instance-secret');
      try {
        const encryptions = new Map<string, SpeakingReferenceEnvelope>();
        const references = await publishSpeakingPromptReferences({
          userId: 'u1',
          classAttempt: { classId: 'class-1', attempt: 1 },
          stageSectionId: 'section-1',
          encryptions,
          required: true,
          execution: {
            ...authorizedLearnerExecution('u1'),
            verifySpeakingReferenceStage: vi.fn().mockResolvedValue(binding),
          },
          prompts: [
            {
              id: 'prompt-1',
              composed: {
                targetPhrase: 'Hola',
                translation: 'Hello',
                ipa: null,
                referenceTtsAudio: Buffer.from('reference speech'),
              },
            },
          ],
        });
        expect(references.get('prompt-1')).toBe('stored-reference');
        expect(encryptions.get('prompt-1')).toEqual(storedEnvelope);
        expect(Buffer.from(storedAudio!)).not.toEqual(Buffer.from('reference speech'));
        expect(
          decryptSpeakingReferenceChunk(
            storedAudio!,
            storedEnvelope,
            binding,
            speakingReferenceWrappingKey(),
            0
          ).toString()
        ).toBe('reference speech');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('rejects a staged reference if its authorized prompt incarnation changes during publication', async () => {
      const snapshot = {
        instanceId: 'instance',
        scopes: [{ subjectId: 'profile:u1', generation: 1 }],
        reference: null,
        associations: { promptId: 'prompt-1', createdAt: 1, parents: [] },
      };
      vi.mocked(captureSpeakingPromptStorage).mockResolvedValue(snapshot);
      const binding: SpeakingReferenceBinding = {
        instanceId: '00000000-0000-4000-8000-000000000001',
        userId: 'u1',
        userCreatedAt: 1,
        courseId: 'course-1',
        courseCreatedAt: 2,
        classId: 'class-1',
        classCreatedAt: 3,
        sectionId: 'section-1',
        sectionIncarnationId: '00000000-0000-4000-8000-000000000002',
        promptId: 'prompt-1',
        promptIncarnationId: '00000000-0000-4000-8000-000000000003',
        attempt: 1,
        operationId: '00000000-0000-4000-8000-000000000004',
        sourceHash: 'a'.repeat(64),
      };
      const verify = vi
        .fn()
        .mockResolvedValueOnce(binding)
        .mockResolvedValueOnce(binding)
        .mockResolvedValueOnce({
          ...binding,
          promptIncarnationId: '00000000-0000-4000-8000-000000000005',
        });
      const database = {
        $queryRaw: async () => [],
        courseClass: {
          findUnique: async () => ({ status: 'GENERATING', attempt: 1, course: { userId: 'u1' } }),
        },
      } as unknown as Prisma.TransactionClient;
      mockWriteStorageReference.mockImplementationOnce(
        async (options: {
          body: Uint8Array;
          contentType: string;
          captureAdmission: (
            tx: Prisma.TransactionClient
          ) => Promise<StorageReferenceAdmission<typeof snapshot>>;
          validateAdmission: (
            tx: Prisma.TransactionClient,
            admission: StorageReferenceAdmission<typeof snapshot>,
            reference: string
          ) => Promise<void>;
        }) => {
          expect(options.contentType).toBe('application/octet-stream');
          expect(Buffer.from(options.body)).not.toEqual(Buffer.of(1));
          const admission = await options.captureAdmission(database);
          await options.validateAdmission(database, admission, 'stored-reference');
          return 'stored-reference';
        }
      );
      vi.stubEnv('BYOK_ENCRYPTION_KEY', 'test-instance-secret');
      try {
        await expect(
          publishSpeakingPromptReferences({
            userId: 'u1',
            classAttempt: { classId: 'class-1', attempt: 1 },
            stageSectionId: 'section-1',
            encryptions: new Map(),
            required: true,
            execution: {
              ...authorizedLearnerExecution('u1'),
              verifySpeakingReferenceStage: verify,
            },
            prompts: [
              {
                id: 'prompt-1',
                composed: {
                  targetPhrase: 'Hola',
                  translation: 'Hello',
                  ipa: null,
                  referenceTtsAudio: Uint8Array.of(1),
                },
              },
            ],
          })
        ).rejects.toThrow('Speaking reference staging identity changed');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it.each([false, true])(
      'checks prompt ownership after a committed retry (changed: %s)',
      async (changed) => {
        const snapshot = {
          instanceId: 'instance',
          scopes: [{ subjectId: 'profile:u1', generation: 1 }],
          reference: null as string | null,
          associations: {
            promptId: 'prompt-1',
            createdAt: 1,
            parents: [
              { kind: 'class', id: 'section-1', parentId: 'class-1', courseId: 'course-1' },
            ],
          },
        };
        const database = {} as Prisma.TransactionClient;
        vi.mocked(captureSpeakingPromptStorage)
          .mockResolvedValueOnce(snapshot)
          .mockResolvedValueOnce({
            ...snapshot,
            reference: 'stored-reference',
            associations: {
              ...snapshot.associations,
              parents: [
                {
                  ...snapshot.associations.parents[0]!,
                  parentId: changed ? 'other-class' : 'class-1',
                },
              ],
            },
          });
        mockWriteStorageReference.mockImplementationOnce(
          async (options: {
            captureAdmission: (
              tx: Prisma.TransactionClient
            ) => Promise<StorageReferenceAdmission<typeof snapshot>>;
            validateAdmission: (
              tx: Prisma.TransactionClient,
              admission: StorageReferenceAdmission<typeof snapshot>,
              reference: string
            ) => Promise<void>;
          }) => {
            const admission = await options.captureAdmission(database);
            expect(admission.scopes).toContainEqual({ subjectId: 'class:class-1', generation: 2 });
            await options.validateAdmission(database, admission, 'stored-reference');
            return 'stored-reference';
          }
        );
        const publication = publishSpeakingPromptReferences({
          userId: 'u1',
          execution: authorizedLearnerExecution('u1'),
          required: true,
          prompts: [
            {
              id: 'prompt-1',
              composed: {
                targetPhrase: 'Hola',
                translation: 'Hello',
                ipa: null,
                referenceTtsAudio: Uint8Array.of(1),
              },
            },
          ],
        });
        if (changed)
          await expect(publication).rejects.toThrow('Speaking reference ownership changed');
        else
          await expect(publication).resolves.toEqual(new Map([['prompt-1', 'stored-reference']]));
      }
    );
  });
}
