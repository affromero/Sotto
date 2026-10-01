import type { ClassPreparation } from './preparation-state';
import { validateClassPreparation } from './preparation';
import { classPreparationGrant } from './preparation-grant';
import { learningPreparationProviderRequest } from '../learning/preparation/preparation-provider';

export function preparationProviderRequest(
  operation: ClassPreparation,
  signal: AbortSignal,
  unresolved: () => void
) {
  return learningPreparationProviderRequest(
    {
      selection: operation.selection,
      admit: async (database, attempt) => {
        const current = await validateClassPreparation(database, operation.courseId, operation.id);
        return classPreparationGrant(database, current).admit(current.grant, attempt);
      },
      settle: async (database, attempt, outcome) => {
        const current = await validateClassPreparation(
          database,
          operation.courseId,
          operation.id,
          true
        );
        return classPreparationGrant(database, current).settle(current.grant, attempt, outcome);
      },
    },
    signal,
    unresolved
  );
}
