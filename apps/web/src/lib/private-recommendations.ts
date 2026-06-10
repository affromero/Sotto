/**
 * Behavioral archetype classification — the surviving piece of the former
 * recommendation scoring layer, still used by `feature-computation.worker.ts`
 * to tag a learner's listening sessions for the admin analytics feature store.
 */
export type Archetype = 'deep_listener' | 'skimmer' | 'explorer' | 'completer' | 'active_learner';

export interface ArchetypeInput {
  avgCompletionRate: number;
  avgSpeed: number;
  sessions: Array<{ seekCount: number; interruptCount: number }>;
}

export function classifyArchetype(input: ArchetypeInput): Archetype {
  const avgSeeks =
    input.sessions.length > 0
      ? input.sessions.reduce((sum, session) => sum + session.seekCount, 0) / input.sessions.length
      : 0;
  const avgInteractions =
    input.sessions.length > 0
      ? input.sessions.reduce((sum, session) => sum + session.interruptCount, 0) /
        input.sessions.length
      : 0;

  if (input.avgCompletionRate > 90 && input.avgSpeed <= 1.25) return 'deep_listener';
  if (input.avgCompletionRate < 50 && input.avgSpeed > 1.25 && avgSeeks > 2) return 'skimmer';
  if (input.avgCompletionRate > 90 && avgInteractions < 0.5) return 'completer';
  if (avgInteractions > 1) return 'active_learner';
  return 'explorer';
}
