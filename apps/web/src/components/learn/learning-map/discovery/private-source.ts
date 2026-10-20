import type { CefrLevel } from '@sotto/shared';

/** Owned server course context, independent of a published catalog or mastery response. */
export interface PrivateSourceContext {
  kind: 'PRIVATE_SOURCE';
  courseId: string;
  targetLang: string;
  currentLevel: CefrLevel;
  viewedLevel: CefrLevel;
}
