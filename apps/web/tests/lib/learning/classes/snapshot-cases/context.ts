import type { SharedTestInstance } from '../../../../helpers/setup/shared-instance';
import type { createSnapshotFixture } from './fixture';

export interface SnapshotContext {
  instance: SharedTestInstance;
  ownerId: string;
  ownerToken: string;
  classId: string;
  courseId: string;
  fixture: (
    withListening?: boolean,
    withSpeaking?: boolean,
    reserveAudio?: boolean,
    materialVersion?: 1 | 2
  ) => ReturnType<typeof createSnapshotFixture>;
}
