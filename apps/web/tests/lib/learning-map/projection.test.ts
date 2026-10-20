import { describe, expect, it } from 'vitest';
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

describe('objective evidence projection', () => {
  it('leaves an unseen objective neutral and unassessed', () => {
    expect(projectObjectiveEvidence([])).toMatchObject({
      mastery: 0.5,
      assessedTasks: 0,
      assessedSessions: 0,
      dueAt: null,
    });
  });
  it('bounds the influence of correlated questions and schedules the session once', () => {
    const single = projectObjectiveEvidence([task('one', 'a')]);
    const many = projectObjectiveEvidence(
      Array.from({ length: 50 }, (_, index) => task('one', `q${index}`))
    );
    expect(many.mastery).toBe(single.mastery);
    expect(many.reps).toBe(single.reps);
    expect(many.assessedTasks).toBe(50);
    expect(many.assessedSessions).toBe(1);
  });
  it('credits separate sessions and preserves deterministic rebuilds', () => {
    const observations = [task('one', 'a'), task('two', 'b', 1, '2026-10-03T12:00:00Z')];
    const result = projectObjectiveEvidence(observations);
    expect(result.mastery).toBeGreaterThan(0.85);
    expect(result.reps).toBe(2);
    expect(projectObjectiveEvidence([...observations].reverse())).toEqual(result);
    expect(projectObjectiveEvidence([...observations, observations[0]!])).toEqual(result);
  });
  it('revises the same task without increasing opportunities or session repetitions', () => {
    const result = projectObjectiveEvidence([
      task('one', 'a'),
      task('one', 'a', 0, '2026-10-02T12:00:00Z'),
    ]);
    expect(result.assessedTasks).toBe(1);
    expect(result.assessedSessions).toBe(1);
    expect(result.lastQuality).toBe(0);
    expect(result.mastery).toBeLessThan(0.5);
  });
  it('rebuilds equal-time sessions independently of database ordering', () => {
    const observations = [task('alpha', 'a', 0), task('beta', 'b', 1)];
    expect(projectObjectiveEvidence(observations)).toEqual(
      projectObjectiveEvidence([...observations].reverse())
    );
  });
});
