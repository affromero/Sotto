import { classPresentationIssues, type ClassData } from '../classTypes';

export interface ClassRefreshOptions {
  signal?: AbortSignal;
  isExpectedMaterial?: (data: ClassData) => boolean;
  operation?: {
    id: string;
    courseId: string;
    onStopped: (data: ClassData) => void;
  };
}

/** Wait for canonical class publication and observe the admitted preparation. */
export async function waitForClassRefresh(
  fetchClassData: () => Promise<ClassData>,
  { isExpectedMaterial = () => true, operation, signal }: ClassRefreshOptions = {}
): Promise<ClassData> {
  const startedAt = Date.now();
  let lastIssues: string[] = [];
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 2000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    signal?.throwIfAborted();
    const data = await fetchClassData();
    signal?.throwIfAborted();
    if (operation) {
      const response = await fetch(`/api/v1/courses/${operation.courseId}/generation`, { signal });
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error('Preparation status could not be checked. Please reload the class.');
      const progress = (await response.json()) as {
        operationId?: string;
        status?: string;
        detail?: string;
      };
      signal?.throwIfAborted();
      if (progress.operationId !== operation.id) {
        throw new Error('This preparation changed. Please check the class before trying again.');
      }
      if (progress.status === 'UNRESOLVED') {
        throw new Error(
          progress.detail ?? 'Preparation needs recovery. Your previous work is retained.'
        );
      }
      if (['FAILED', 'CANCELLED'].includes(progress.status ?? '')) {
        const restored = await fetchClassData();
        signal?.throwIfAborted();
        if (restored.status === 'GENERATING') continue;
        operation.onStopped(restored);
        throw new Error(
          progress.detail ?? 'New questions could not be prepared. Your previous work is retained.'
        );
      }
    }
    const issues = data.submitted ? [] : classPresentationIssues(data);
    lastIssues = issues;
    if (data.status === 'FAILED') {
      throw new Error(`Class refresh failed: ${issues.join(' ') || 'generation failed.'}`);
    }
    if (data.status !== 'GENERATING' && issues.length === 0 && isExpectedMaterial(data))
      return data;
  }
  throw new Error(
    `Class refresh timed out before required material was ready: ${lastIssues.join(' ') || 'class is still incomplete.'}`
  );
}
