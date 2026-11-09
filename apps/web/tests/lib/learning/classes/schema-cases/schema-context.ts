import type { SharedTestInstance } from '../../../../helpers/setup/shared-instance';

export interface AssessmentSchemaContext {
  instance: SharedTestInstance;
  ownerId: string;
  courseId: string;
  classId: string;
  assessment: (
    attempt: number,
    number: number
  ) => {
    classId: string;
    courseId: string;
    userId: string;
    classAttempt: number;
    assessmentAttempt: number;
    requirements: Record<string, never>;
    formativeRevision: string;
    teachingKind: string;
    teachingReceiptId: string;
  };
}
