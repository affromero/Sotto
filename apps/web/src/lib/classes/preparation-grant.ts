import type { Prisma } from '@/generated/prisma/client';
import type { ClassPreparation } from './preparation-state';
import {
  learningPreparationGrant,
  learningPreparationGrantSpec,
} from '../learning/preparation/preparation-grant';

export const preparationGrantSpec = (operation: ClassPreparation) =>
  learningPreparationGrantSpec(operation, 'class');
export const classPreparationGrant = (
  database: Prisma.TransactionClient,
  operation: Pick<ClassPreparation, 'id' | 'courseId' | 'userId'>
) => learningPreparationGrant(database, operation, 'class');
