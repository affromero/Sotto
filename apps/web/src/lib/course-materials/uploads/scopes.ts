import type { Prisma } from '@/generated/prisma/client';
import { materialStorageScopes } from '../index';

export interface MaterialUploadStorageIdentity {
  id: string;
  createdAt: Date;
  material: { id: string; userId: string; createdAt: Date };
}

/** Transfer artifacts additionally carry the upload fence; retained originals do not. */
export async function materialUploadStorageScopes(
  database: Prisma.TransactionClient,
  upload: MaterialUploadStorageIdentity
) {
  const ownership = await materialStorageScopes(database, upload.material);
  return {
    ...ownership,
    scopes: [
      ...ownership.scopes,
      { subjectId: `material-upload:${upload.id}`, generation: upload.createdAt.getTime() },
    ].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
  };
}
