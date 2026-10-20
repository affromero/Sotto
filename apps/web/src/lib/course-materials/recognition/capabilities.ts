import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { OptimisticStateStore } from 'thesidedoor-core/storage/optimistic';
import { sqlStateBackend } from 'thesidedoor-core/storage/sql';
import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  materialRecognitionCapabilitySchema,
  materialRecognitionHash,
  type MaterialRecognitionCapability,
} from './protocol';

export const MATERIAL_RECOGNITION_CAPABILITIES_ID = `${SIDEDOOR_STATE_ID}:material-recognition-capabilities`;
const registryRevision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reviewIdentity = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/);

function credentialFreeUrl(value: string, documentation: boolean) {
  if (/[\u0000-\u001f\u007f]/.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (documentation ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) &&
    !url.username &&
    !url.password &&
    !url.search &&
    (documentation || !url.hash)
  );
}

const reviewedCapabilitySchema = materialRecognitionCapabilitySchema.superRefine(
  (value, context) => {
    for (const field of ['provider', 'model', 'reviewId', 'revision'] as const) {
      if (/[\u0000-\u001f\u007f]/.test(value[field]))
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Review identities cannot contain control characters.',
        });
    }
    if (
      value.endpoint !== null &&
      (value.endpoint.length > 2048 || !credentialFreeUrl(value.endpoint, false))
    )
      context.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'Use a base HTTP endpoint without credentials, query parameters or a fragment.',
      });
  }
);
const documentationUrlSchema = z
  .url()
  .max(2048)
  .refine((url) => credentialFreeUrl(url, true), {
    message: 'Use HTTPS documentation without credentials or query parameters.',
  });
const materialRecognitionCapabilityRecordSchema = z
  .object({
    capability: reviewedCapabilitySchema,
    documentationUrl: documentationUrlSchema,
    active: z.boolean(),
  })
  .strict();

function selectionKey(selection: { provider: string; model: string; endpoint?: string | null }) {
  return JSON.stringify([selection.provider, selection.model, selection.endpoint ?? null]);
}
function reviewKey(capability: Pick<MaterialRecognitionCapability, 'reviewId' | 'revision'>) {
  return JSON.stringify([capability.reviewId, capability.revision]);
}

export const materialRecognitionCapabilitiesStateSchema = z
  .object({
    revision: registryRevision,
    capabilities: z.array(materialRecognitionCapabilityRecordSchema).max(100),
  })
  .strict()
  .superRefine((state, context) => {
    const reviews = new Set<string>();
    const active = new Set<string>();
    for (const record of state.capabilities) {
      const review = reviewKey(record.capability);
      const selection = selectionKey(record.capability);
      if (reviews.has(review) || (record.active && active.has(selection)))
        context.addIssue({
          code: 'custom',
          message: 'Review versions and active model selections must be unique.',
        });
      reviews.add(review);
      if (record.active) active.add(selection);
    }
  });

export const reviewMaterialRecognitionCapabilitySchema = z
  .object({
    expectedRevision: registryRevision,
    operatorConfirmed: z.literal(true),
    capability: reviewedCapabilitySchema,
    documentationUrl: documentationUrlSchema,
  })
  .strict();
export const revokeMaterialRecognitionCapabilitySchema = z
  .object({
    expectedRevision: registryRevision,
    reviewId: reviewIdentity,
    revision: reviewIdentity,
    active: z.literal(false),
  })
  .strict();
type CapabilityReviewRequest = z.infer<typeof reviewMaterialRecognitionCapabilitySchema>;
type CapabilityRevocationRequest = z.infer<typeof revokeMaterialRecognitionCapabilitySchema>;
interface CapabilityOwnerAdmission {
  request: Request;
  admission: AuthenticatedRequest;
}

function capabilitiesStore(database: Prisma.TransactionClient) {
  return new OptimisticStateStore({
    backend: sqlStateBackend(
      {
        query: (sql, values) => database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      },
      'postgres',
      MATERIAL_RECOGNITION_CAPABILITIES_ID
    ),
    parse: (value) => materialRecognitionCapabilitiesStateSchema.parse(value),
    initial: () => ({ revision: 0, capabilities: [] }),
  });
}

/** Owner and selected content identity are checked again in the mutation transaction. */
export async function requireMaterialRecognitionCapabilityOwner(
  database: Prisma.TransactionClient,
  authority: CapabilityOwnerAdmission
) {
  if (!authority.admission.isOwner) throw new AccessError('forbidden');
  await requireOriginalSottoAdmission(database, authority.request, authority.admission);
}

/** Server-side configuration read. HTTP exposure separately requires owner authority. */
export function readMaterialRecognitionCapabilities(database: Prisma.TransactionClient) {
  return capabilitiesStore(database).read();
}

/** Review identity is the replay key. Published reviews and documentation never change. */
export async function reviewMaterialRecognitionCapability(
  database: Prisma.TransactionClient,
  authority: CapabilityOwnerAdmission,
  input: CapabilityReviewRequest
) {
  const request = reviewMaterialRecognitionCapabilitySchema.parse(input);
  await requireMaterialRecognitionCapabilityOwner(database, authority);
  return capabilitiesStore(database).transact((state) => {
    const prior = state.capabilities.find(
      (record) => reviewKey(record.capability) === reviewKey(request.capability)
    );
    if (prior) {
      if (
        !isDeepStrictEqual(prior.capability, request.capability) ||
        prior.documentationUrl !== request.documentationUrl
      )
        throw new AccessError(
          'conflict',
          'Published reviews cannot change. Create a new review version.'
        );
      return state;
    }
    if (state.revision !== request.expectedRevision)
      throw new AccessError(
        'conflict',
        'Recognition capability settings changed. Refresh and try again.'
      );
    if (state.capabilities.length >= 100)
      throw new AccessError('conflict', 'This instance already retains 100 capability reviews.');
    if (
      state.capabilities.some(
        (record) =>
          record.active && selectionKey(record.capability) === selectionKey(request.capability)
      )
    )
      throw new AccessError(
        'conflict',
        'Revoke the active review for this exact model before adding a new version.'
      );
    state.capabilities.push({
      capability: request.capability,
      documentationUrl: request.documentationUrl,
      active: true,
    });
    state.revision += 1;
    return state;
  });
}

/** Revocation retains the immutable review and cannot reactivate it through replay. */
export async function revokeMaterialRecognitionCapability(
  database: Prisma.TransactionClient,
  authority: CapabilityOwnerAdmission,
  input: CapabilityRevocationRequest
) {
  const request = revokeMaterialRecognitionCapabilitySchema.parse(input);
  await requireMaterialRecognitionCapabilityOwner(database, authority);
  return capabilitiesStore(database).transact((state) => {
    const record = state.capabilities.find(
      (item) => reviewKey(item.capability) === reviewKey(request)
    );
    if (!record) throw new AccessError('invalid', 'The capability review does not exist.');
    if (!record.active) return state;
    if (state.revision !== request.expectedRevision)
      throw new AccessError(
        'conflict',
        'Recognition capability settings changed. Refresh and try again.'
      );
    record.active = false;
    state.revision += 1;
    return state;
  });
}

export function materialRecognitionCapabilityHash(capability: MaterialRecognitionCapability) {
  return materialRecognitionHash(materialRecognitionCapabilitySchema.parse(capability));
}

/** Exact configured selection only. Missing reviews do not select another provider or model. */
export async function findMaterialRecognitionCapability(
  database: Prisma.TransactionClient,
  selection: { provider: string; model: string; endpoint?: string | null }
) {
  const state = await readMaterialRecognitionCapabilities(database);
  const record = state.capabilities.find(
    (item) => item.active && selectionKey(item.capability) === selectionKey(selection)
  );
  return record
    ? {
        capability: record.capability,
        record,
        capabilitySha256: materialRecognitionCapabilityHash(record.capability),
      }
    : null;
}

/** Revalidate the frozen review before dispatch and publication in the caller transaction. */
export async function validateMaterialRecognitionCapability(
  database: Prisma.TransactionClient,
  expected: MaterialRecognitionCapability
) {
  const capability = materialRecognitionCapabilitySchema.parse(expected);
  const current = await findMaterialRecognitionCapability(database, capability);
  if (!current || current.capabilitySha256 !== materialRecognitionCapabilityHash(capability))
    throw new AccessError(
      'conflict',
      'The reviewed recognition capability changed or was revoked.'
    );
  return current;
}
