import { updateMasteryPosterior } from '@sotto/learning-model';
import { OBJECTIVE_MASTERY_POLICY } from '@sotto/shared';
import { reviewSchedule } from '../../srs';

export interface ProjectionObservation {
  sessionId: string;
  /** Stable exact-task identity across sessions, independent of responses and grades. */
  taskId: string;
  responseIdentity: string;
  quality: number;
  observedAt: Date;
}

interface SessionEvidence {
  sessionId: string;
  tasks: Map<string, ProjectionObservation>;
  latestAt: Date;
}

function orderedSessions(sessions: Map<string, SessionEvidence>) {
  return [...sessions.values()].sort(
    (left, right) =>
      left.latestAt.getTime() - right.latestAt.getTime() ||
      left.sessionId.localeCompare(right.sessionId)
  );
}

function sessionQuality(session: SessionEvidence): number {
  const tasks = [...session.tasks.values()];
  return tasks.reduce((total, task) => total + task.quality, 0) / tasks.length;
}

/**
 * Rebuild one course/objective/criterion/policy/level/skill scope supplied by the caller.
 * A task belongs to its first session forever. Its latest response updates that
 * opportunity's strength; later review sessions never create another opportunity.
 * Scheduling uses actual responses in every distinct session, including reviews.
 */
export function projectObjectiveEvidence(observations: readonly ProjectionObservation[]) {
  for (const observation of observations) {
    if (
      !Number.isFinite(observation.quality) ||
      observation.quality < 0 ||
      observation.quality > 1 ||
      !Number.isFinite(observation.observedAt.getTime())
    )
      throw new Error('Invalid objective observation.');
  }
  const ordered = [...observations].sort(
    (left, right) =>
      left.observedAt.getTime() - right.observedAt.getTime() ||
      left.sessionId.localeCompare(right.sessionId) ||
      left.taskId.localeCompare(right.taskId) ||
      left.responseIdentity.localeCompare(right.responseIdentity)
  );
  const tasks = new Map<
    string,
    { ownerSessionId: string; firstAt: Date; latest: ProjectionObservation }
  >();
  const reviews = new Map<string, SessionEvidence>();
  for (const observation of ordered) {
    const previous = tasks.get(observation.taskId);
    tasks.set(observation.taskId, {
      ownerSessionId: previous?.ownerSessionId ?? observation.sessionId,
      firstAt: previous?.firstAt ?? observation.observedAt,
      latest: observation,
    });
    const review = reviews.get(observation.sessionId) ?? {
      sessionId: observation.sessionId,
      tasks: new Map(),
      latestAt: observation.observedAt,
    };
    // Revised answers replace the task's quality within this actual review session.
    review.tasks.set(observation.taskId, observation);
    review.latestAt = observation.observedAt;
    reviews.set(observation.sessionId, review);
  }
  const opportunities = new Map<string, SessionEvidence>();
  for (const [taskId, task] of tasks) {
    const session = opportunities.get(task.ownerSessionId) ?? {
      sessionId: task.ownerSessionId,
      tasks: new Map(),
      latestAt: task.firstAt,
    };
    session.tasks.set(taskId, task.latest);
    if (task.firstAt.getTime() > session.latestAt.getTime()) session.latestAt = task.firstAt;
    opportunities.set(task.ownerSessionId, session);
  }
  let mastery: number = OBJECTIVE_MASTERY_POLICY.prior;
  for (const session of orderedSessions(opportunities)) {
    mastery = updateMasteryPosterior(mastery, {
      quality: sessionQuality(session),
      weight: OBJECTIVE_MASTERY_POLICY.sessionWeightLimit,
    });
  }
  let schedule = {
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: null as Date | null,
  };
  let lastQuality: number | null = null;
  let lastReviewed: Date | null = null;
  for (const session of orderedSessions(reviews)) {
    lastQuality = sessionQuality(session);
    schedule = reviewSchedule(schedule, lastQuality, session.latestAt);
    lastReviewed = session.latestAt;
  }
  return {
    mastery,
    assessedTasks: tasks.size,
    assessedSessions: opportunities.size,
    lastQuality,
    lastReviewed,
    ...schedule,
  };
}
