import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  classPrerequisiteResponseSchema,
  type ClassLessonHelpResponse,
  type ClassPrerequisiteResponse,
} from '@sotto/shared';
import { deriveOwnedCredentialKey } from '@/lib/credentials/byok-crypto';

type Revision = { sourceHash: string; snapshotHash: string };
const digest = /^[a-f0-9]{64}$/;

/** Capture one scoped key per request, and erase its local copy after use. */
export function createPrerequisiteTokenizer(classId: string, userId: string) {
  const key = deriveOwnedCredentialKey();
  let disposed = false;
  const sign = (kind: string, value: string) => {
    if (disposed) throw new Error('Invalid prerequisite revision.');
    return createHmac('sha256', key)
      .update(JSON.stringify(['class-prerequisite-revision-v1', kind, classId, userId, value]))
      .digest('hex');
  };
  const token = (kind: string, value: string) => {
    if (!digest.test(value)) throw new Error('Invalid prerequisite revision.');
    return sign(kind, value);
  };
  const helpSource = (value: string) => token('lesson-help-source', value);
  const helpOperation = (value: string) => {
    const hex = sign('lesson-help-operation', value).slice(0, 32).split('');
    hex[12] = '4';
    hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
    const id = hex.join('');
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  };
  const source = (value: string) => token('source', value);
  const request = (revision: Revision): Revision => ({
    sourceHash: source(revision.sourceHash),
    snapshotHash: token('snapshot', revision.snapshotHash),
  });
  const equal = (left: string, right: string) =>
    digest.test(left) &&
    digest.test(right) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  return {
    source,
    material: (value: string) => token('task-material', value),
    assessment: (value: string) => token('assessment-source', value),
    helpSource,
    help: (value: ClassLessonHelpResponse): ClassLessonHelpResponse => ({
      ...value,
      request: {
        ...value.request,
        sourceHash: helpSource(value.request.sourceHash),
        operationId: helpOperation(value.request.operationId),
        retryOf: value.request.retryOf ? helpOperation(value.request.retryOf) : null,
      },
    }),
    request,
    matchesSource: (supplied: string, actual: string) => equal(supplied, source(actual)),
    matches: (supplied: Revision, actual: Revision) => {
      const expected = request(actual);
      return (
        equal(supplied.sourceHash, expected.sourceHash) &&
        equal(supplied.snapshotHash, expected.snapshotHash)
      );
    },
    status: (value: unknown): ClassPrerequisiteResponse => {
      const parsed = classPrerequisiteResponseSchema.parse(value);
      return { ...parsed, request: request(parsed.request) };
    },
    dispose: () => {
      key.fill(0);
      disposed = true;
    },
  };
}
