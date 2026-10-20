// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { objectiveEvidenceStatus } from '@sotto/shared';
import {
  projectObjectiveEvidence,
  type ProjectionObservation,
} from '@/lib/learning-map/evidence/projection';

function task(
  sessionId: string,
  taskId: string,
  quality = 1,
  time = '2026-10-01T12:00:00Z'
): ProjectionObservation {
  return {
    sessionId,
    taskId,
    responseIdentity: `${sessionId}-${taskId}-${quality}`,
    quality,
    observedAt: new Date(time),
  };
}

function status(observations: ProjectionObservation[]) {
  const projection = projectObjectiveEvidence(observations);
  return objectiveEvidenceStatus({
    ...projection,
    objectiveId: 'de.g.perfekt-haben-sein',
    criterionVersion: 1,
    policyVersion: 1,
    level: 'A2',
    skill: 'GRAMMAR',
    lastReviewed: projection.lastReviewed?.toISOString() ?? null,
    dueAt: projection.dueAt?.toISOString() ?? null,
  });
}

describe('objective evidence projection', () => {
  it('leaves an unseen objective neutral and unassessed', () => {
    expect(projectObjectiveEvidence([])).toMatchObject({
      mastery: 0.5,
      assessedTasks: 0,
      assessedSessions: 0,
      dueAt: null,
    });
  });
  it('bounds correlated questions and schedules their session once', () => {
    const single = projectObjectiveEvidence([task('one', 'a')]);
    const many = projectObjectiveEvidence(
      Array.from({ length: 50 }, (_, index) => task('one', `q${index}`))
    );
    expect(many.mastery).toBe(single.mastery);
    expect(many.reps).toBe(single.reps);
    expect(many.assessedTasks).toBe(50);
    expect(many.assessedSessions).toBe(1);
  });
  it('credits distinct tasks in separate sessions and rebuilds deterministically', () => {
    const observations = [task('one', 'a'), task('two', 'b', 1, '2026-10-03T12:00:00Z')];
    const result = projectObjectiveEvidence(observations);
    expect(result.mastery).toBeGreaterThan(0.85);
    expect(result.assessedSessions).toBe(2);
    expect(result.reps).toBe(2);
    expect(projectObjectiveEvidence([...observations].reverse())).toEqual(result);
    expect(projectObjectiveEvidence([...observations, observations[0]!])).toEqual(result);
  });
  it('revises a task within its session without adding opportunities or reviews', () => {
    const result = projectObjectiveEvidence([
      task('one', 'a'),
      task('one', 'a', 0, '2026-10-02T12:00:00Z'),
    ]);
    expect(result.assessedTasks).toBe(1);
    expect(result.assessedSessions).toBe(1);
    expect(result.lastQuality).toBe(0);
    expect(result.mastery).toBeLessThan(0.5);
    expect(result.lapses).toBe(1);
  });
  it('keeps exact task reuse across sessions out of task and session mastery credit', () => {
    const first = projectObjectiveEvidence([task('one', 'a')]);
    const repeated = projectObjectiveEvidence([
      task('one', 'a'),
      task('two', 'a', 1, '2026-10-03T12:00:00Z'),
      task('three', 'a', 1, '2026-10-06T12:00:00Z'),
    ]);
    expect(repeated.mastery).toBe(first.mastery);
    expect(repeated.assessedTasks).toBe(1);
    expect(repeated.assessedSessions).toBe(1);
    expect(repeated.reps).toBe(3);
    expect(repeated.lastReviewed).toEqual(new Date('2026-10-06T12:00:00Z'));
    expect(repeated.dueAt!.getTime()).toBeGreaterThan(first.dueAt!.getTime());
  });
  it('updates strength from a successful real review without inventing another opportunity', () => {
    const first = projectObjectiveEvidence([task('one', 'a', 0)]);
    const reviewed = projectObjectiveEvidence([
      task('one', 'a', 0),
      task('two', 'a', 1, '2026-10-03T12:00:00Z'),
    ]);
    expect(reviewed.mastery).toBe(projectObjectiveEvidence([task('one', 'a')]).mastery);
    expect(reviewed.mastery).toBeGreaterThan(first.mastery);
    expect(reviewed.assessedTasks).toBe(1);
    expect(reviewed.assessedSessions).toBe(1);
    expect(reviewed.reps).toBe(1);
    expect(reviewed.lapses).toBe(1);
    expect(reviewed.lastQuality).toBe(1);
  });
  it('retains weak review diagnostics and due timing without accumulating negative opportunities', () => {
    const reviewed = projectObjectiveEvidence([
      task('one', 'a'),
      task('two', 'a', 0, '2026-10-03T12:00:00Z'),
    ]);
    expect(reviewed.mastery).toBe(projectObjectiveEvidence([task('one', 'a', 0)]).mastery);
    expect(reviewed).toMatchObject({
      assessedTasks: 1,
      assessedSessions: 1,
      lastQuality: 0,
      reps: 0,
      lapses: 1,
    });
    expect(reviewed.dueAt).toEqual(new Date('2026-10-03T12:00:00Z'));
    expect(status([task('one', 'a'), task('two', 'a', 0, '2026-10-03T12:00:00Z')])).toBe(
      'NEEDS_WORK'
    );
  });
  it('keeps latest diagnostic strength attached to each task original session', () => {
    const observations = [
      task('one', 'a', 0),
      task('one', 'b', 0),
      task('two', 'a', 1, '2026-10-03T12:00:00Z'),
    ];
    const reviewed = projectObjectiveEvidence(observations);
    const equivalentStrength = projectObjectiveEvidence([task('one', 'a'), task('one', 'b', 0)]);
    expect(reviewed.mastery).toBe(equivalentStrength.mastery);
    expect(reviewed.mastery).toBeCloseTo(0.5);
    expect(reviewed.assessedSessions).toBe(1);
    // The latest review answered only a successfully. It did not re-answer b.
    expect(reviewed.lastQuality).toBe(1);
    expect(reviewed.reps).toBe(1);
    expect(reviewed.lapses).toBe(1);
  });
  it('uses only novel tasks for a mixed session mastery contribution', () => {
    const reviewed = projectObjectiveEvidence([
      task('one', 'a'),
      task('two', 'a', 0, '2026-10-03T12:00:00Z'),
      task('two', 'b', 1, '2026-10-03T12:00:00Z'),
    ]);
    const equivalentStrength = projectObjectiveEvidence([
      task('one', 'a', 0),
      task('two', 'b', 1, '2026-10-03T12:00:00Z'),
    ]);
    expect(reviewed.mastery).toBe(equivalentStrength.mastery);
    expect(reviewed).toMatchObject({
      assessedTasks: 2,
      assessedSessions: 2,
      lastQuality: 0.5,
      lapses: 1,
    });
  });
  it('cannot qualify through recycling five successful tasks in later sessions', () => {
    const original = Array.from({ length: 5 }, (_, index) => task('one', `q${index}`));
    const reviews = Array.from({ length: 9 }, (_, session) =>
      original.map((item) => task(`review-${session}`, item.taskId, 1, '2026-10-03T12:00:00Z'))
    ).flat();
    expect(projectObjectiveEvidence([...original, ...reviews])).toMatchObject({
      assessedTasks: 5,
      assessedSessions: 1,
      reps: 10,
    });
    expect(status([...original, ...reviews])).toBe('PRACTISING');
    expect(status([...original, task('new', 'q5', 1, '2026-10-04T12:00:00Z')])).toBe('CONFIDENT');
  });
  it('does not move opportunity ownership when an earlier session is revised later', () => {
    const observations = [
      task('one', 'a', 0),
      task('one', 'b', 0),
      task('two', 'a', 1, '2026-10-03T12:00:00Z'),
      task('two', 'c', 0, '2026-10-03T12:00:00Z'),
      task('one', 'b', 1, '2026-10-06T12:00:00Z'),
    ];
    const equivalentStrength = projectObjectiveEvidence([
      task('one', 'a'),
      task('one', 'b'),
      task('two', 'c', 0, '2026-10-03T12:00:00Z'),
    ]);
    const result = projectObjectiveEvidence(observations);
    expect(result.mastery).toBe(equivalentStrength.mastery);
    expect(result).toMatchObject({
      assessedTasks: 3,
      assessedSessions: 2,
      lastQuality: 0.5,
    });
    expect(result.lastReviewed).toEqual(new Date('2026-10-06T12:00:00Z'));
  });
  it('rebuilds equal-time task reuse independently of database ordering and delivery duplicates', () => {
    const observations = [
      task('alpha', 'a', 0),
      task('alpha', 'b'),
      task('beta', 'a'),
      task('beta', 'c', 0),
    ];
    const result = projectObjectiveEvidence(observations);
    for (let offset = 0; offset < observations.length; offset += 1) {
      const rotated = [...observations.slice(offset), ...observations.slice(0, offset)];
      expect(projectObjectiveEvidence(rotated)).toEqual(result);
      expect(projectObjectiveEvidence([...rotated.reverse(), observations[0]!])).toEqual(result);
    }
    expect(result).toMatchObject({
      assessedTasks: 3,
      assessedSessions: 2,
      lastQuality: 0.5,
    });
  });
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid quality %s before rebuilding', (quality) => {
    expect(() => projectObjectiveEvidence([task('one', 'a', quality)])).toThrow(
      'Invalid objective observation'
    );
  });
  it('rejects invalid observation times', () => {
    expect(() => projectObjectiveEvidence([task('one', 'a', 1, 'invalid')])).toThrow(
      'Invalid objective observation'
    );
  });
});
