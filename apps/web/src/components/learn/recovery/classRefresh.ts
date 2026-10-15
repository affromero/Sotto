import { classPresentationIssues, type ClassData } from '../classTypes';

export interface ClassRefreshOptions {
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
  { isExpectedMaterial = () => true, operation }: ClassRefreshOptions = {}
): Promise<ClassData> {
  const startedAt = Date.now();
  let lastIssues: string[] = [];
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
    const data = await fetchClassData();
    if (operation) {
      const response = await fetch(`/api/v1/courses/${operation.courseId}/generation`);
      if (!response.ok)
        throw new Error('Preparation status could not be checked. Please reload the class.');
      const progress = (await response.json()) as {
        operationId?: string;
        status?: string;
        detail?: string;
      };
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
