import type { AgentState } from '../WelcomeFlow';

type SaveStep = 'configuration' | 'credentials';
type AgentSavePlan =
  { allowed: false; message: string } | { allowed: true; steps: readonly SaveStep[] };

/** Plan only non-secret operations. Credential values remain in the active save. */
export function planAgentPersistence(
  method: AgentState['method'],
  owner: boolean,
  hasConfiguration: boolean
): AgentSavePlan {
  if (method === 'url') {
    if (!owner)
      return {
        allowed: false,
        message:
          'Only the owner can configure a model server. Ask the owner to update its address and model.',
      };
    return {
      allowed: true,
      steps: hasConfiguration ? ['configuration', 'credentials'] : ['credentials'],
    };
  }
  const steps: SaveStep[] = ['credentials'];
  if (owner && hasConfiguration) steps.push('configuration');
  return { allowed: true, steps };
}
