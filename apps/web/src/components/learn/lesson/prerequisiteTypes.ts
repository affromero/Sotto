import type { ClassPrerequisiteResponse } from '@sotto/shared';

export interface ClassPrerequisiteDirections {
  classId: string;
  sourceHash: string;
  nativeLang: string;
  directions: NonNullable<ClassPrerequisiteResponse['content']>['directions'];
}
