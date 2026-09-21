import { AccessError } from 'thesidedoor-core/access';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { AuthenticatedRequest } from '@/lib/api-keys';
import { captureConfiguredStorageBackend } from '@/lib/r2';
import { getSiteConfig } from '@/lib/site-config';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';
import { sottoStorageInstance } from '@/lib/sidedoor/access/state/store';
import { runSottoStorageProbe } from '@/lib/sidedoor/storage/core/storage-probe-runtime';

export async function checkSottoStorage(options: {
  database: PrismaClient;
  request: Request;
  admission: AuthenticatedRequest;
  selection: {
    provider: 'local' | 's3' | 'r2';
    localStorageRoot?: string | null;
    endpoint?: string | null;
    bucket?: string | null;
    region?: string | null;
    publicUrl?: string | null;
    accessKeyId?: string | null;
    secretAccessKey?: string | null;
  };
}) {
  const { database, request, admission } = options;
  if (!admission.isOwner) throw new AccessError('forbidden');
  const selection = { ...options.selection };
  const configured = await getSiteConfig();
  const selectedConfiguration = {
    ...configured,
    storageProvider: selection.provider,
    localStorageRoot: selection.localStorageRoot ?? configured.localStorageRoot,
    objectStorageEndpoint: selection.endpoint ?? configured.objectStorageEndpoint,
    objectStorageBucket: selection.bucket ?? configured.objectStorageBucket,
    objectStorageRegion: selection.region ?? configured.objectStorageRegion,
    objectStoragePublicUrl: selection.publicUrl ?? configured.objectStoragePublicUrl,
  };
  const suppliedCredential =
    selection.provider === 'local'
      ? undefined
      : {
          accessKeyId: selection.accessKeyId ?? '',
          secretAccessKey: selection.secretAccessKey ?? '',
        };
  const backend = await captureConfiguredStorageBackend(
    selectedConfiguration,
    undefined,
    suppliedCredential
  );
  async function scope(tx: Prisma.TransactionClient) {
    await requireOriginalSottoAdmission(tx, request, admission);
    const instance = await sottoStorageInstance(tx).read();
    const profile = await tx.user.findUnique({
      where: { id: admission.userId },
      select: { createdAt: true },
    });
    if (!profile) throw new AccessError('unauthorized');
    return {
      instanceId: instance.instanceId,
      scopes: [
        { subjectId: instance.subjectId, generation: instance.generation },
        { subjectId: `profile:${admission.userId}`, generation: profile.createdAt.getTime() },
      ],
      snapshot: profile.createdAt.getTime(),
    };
  }
  await runSottoStorageProbe({
    database,
    signal: request.signal,
    backend,
    readAdmission: scope,
    validateConfiguration: async () => {
      const current = await getSiteConfig();
      if (
        (
          [
            'storageProvider',
            'localStorageRoot',
            'objectStorageEndpoint',
            'objectStorageBucket',
            'objectStorageRegion',
            'objectStoragePublicUrl',
          ] as const
        ).some((key) => current[key] !== configured[key])
      )
        throw new AccessError('conflict', 'Storage configuration changed during the check');
    },
  });
}
