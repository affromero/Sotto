import { updateMasteryPosterior } from '@sotto/learning-model';
import { OBJECTIVE_MASTERY_POLICY } from '@sotto/shared';
import { reviewSchedule } from '../../srs';

export interface ProjectionObservation {
  sessionId: string;
  taskId: string;
  responseIdentity: string;
  quality: number;
  observedAt: Date;
}

/** One bounded posterior contribution and scheduling review per distinct learning session. */
export function projectObjectiveEvidence(observations: readonly ProjectionObservation[]) {
  const sessions = new Map<string, { tasks: Map<string, ProjectionObservation>; latestAt: Date }>();
  const ordered = [...observations].sort(
    (left, right) =>
      left.observedAt.getTime() - right.observedAt.getTime() ||
      left.taskId.localeCompare(right.taskId) ||
      left.responseIdentity.localeCompare(right.responseIdentity)
  );
  for (const observation of ordered) {
    if (
      !Number.isFinite(observation.quality) ||
      observation.quality < 0 ||
      observation.quality > 1 ||
      !Number.isFinite(observation.observedAt.getTime())
    )
      throw new Error('Invalid objective observation.');
    const session = sessions.get(observation.sessionId) ?? {
      tasks: new Map(),
      latestAt: observation.observedAt,
    };
    // Revised answers to an existing task replace its contribution rather than create another opportunity.
    session.tasks.set(observation.taskId, observation);
    session.latestAt = observation.observedAt;
    sessions.set(observation.sessionId, session);
  }
  let mastery: number = OBJECTIVE_MASTERY_POLICY.prior;
  let schedule = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: null as Date | null };
  let lastQuality: number | null = null;
  let lastReviewed: Date | null = null;
  let assessedTasks = 0;
  for (const session of [...sessions.values()].sort(
    (left, right) =>
      left.latestAt.getTime() - right.latestAt.getTime() ||
      [...left.tasks.values()][0].sessionId.localeCompare([...right.tasks.values()][0].sessionId)
  )) {
    const tasks = [...session.tasks.values()];
    lastQuality = tasks.reduce((total, task) => total + task.quality, 0) / tasks.length;
    assessedTasks += tasks.length;
    mastery = updateMasteryPosterior(mastery, {
      quality: lastQuality,
      weight: OBJECTIVE_MASTERY_POLICY.sessionWeightLimit,
    });
    schedule = reviewSchedule(schedule, lastQuality, session.latestAt);
    lastReviewed = session.latestAt;
  }
  return {
    mastery,
    assessedTasks,
    assessedSessions: sessions.size,
    lastQuality,
    lastReviewed,
    ...schedule,
  };
}
