import type { ClassPreparation } from '../preparation-state';

export function preparationProgress(
  operation: ClassPreparation & {
    initialPreparation?: { sourceUrl: string | null; topic: string | null };
  }
) {
  const detail = {
    QUEUED: 'Preparation is saved and will run when a worker is available.',
    RUNNING: 'Preparing this class from your course, notes, and review targets.',
    CANCELLING: 'Stopping preparation and waiting for active work to settle.',
    CANCELLED: 'Preparation was cancelled.',
    COMPLETED: 'Preparation finished.',
    FAILED: 'Preparation failed. You can start a new attempt.',
    UNRESOLVED:
      'Preparation was interrupted. Recovery is required before starting another attempt.',
  }[operation.status];
  return {
    operationId: operation.id,
    ...(operation.initialPreparation ? { initialPreparation: operation.initialPreparation } : {}),
    operationStatus: operation.status,
    status:
      operation.status === 'QUEUED' || operation.status === 'RUNNING'
        ? 'GENERATING'
        : operation.status,
    classId: operation.classId,
    lessonTitle: null,
    stage: operation.status === 'QUEUED' ? 'Queued preparation' : 'Class preparation',
    detail,
    progress: 0,
    currentStep: 0,
    totalSteps: 6,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - operation.createdAt) / 1000)),
    remainingSeconds: null,
    availableAt: new Date(operation.availableAt).toISOString(),
    updatedAt: new Date(operation.updatedAt).toISOString(),
    sections: [],
    timeZone: operation.timeZone,
    maxProviderRequests: operation.maxProviderRequests,
    requestBudgetScope: operation.maxProviderRequests === null ? null : 'parent-preparation',
    aiProvider: operation.selection.provider,
    aiModel: operation.selection.model,
    audioRequiresReview: operation.deferAudio,
    audioEpisodeIds: operation.audioEpisodeIds,
  };
}
