import { randomUUID } from 'node:crypto';
import type { CapturedLearningAi } from '../../learning-ai';
import type { IsolatedClaudeExecution } from './isolated-agent';
import { isolatedContainerJournal } from './isolated-agent-journal';
import { parseAgentModelId } from '../../agent-models/id';
import { prismaUnfiltered } from '../../prisma';
import { sottoTransaction } from '../../sidedoor/access/state/transaction';
import {
  captureSottoExecutionCredential,
  sottoExecutionCredentialFields,
} from '../../sidedoor/credentials/runtime/credential-execution';
import {
  captureSottoProviderAdmission,
  type SottoProviderExecution,
} from '../../sidedoor/credentials/runtime/provider-execution';

/** Opt-in operator configuration. The image and separate API credential are captured together. */
export async function captureIsolatedLearningAi(
  userId: string,
  model: string,
  execution: Omit<SottoProviderExecution, 'userId' | 'credential'>,
  expectedImage?: string
): Promise<CapturedLearningAi | undefined> {
  const image = process.env.SOTTO_ISOLATED_CLAUDE_IMAGE?.trim();
  if (expectedImage && image !== expectedImage)
    throw new Error('The isolated Claude image changed after admission');
  if (!image) return undefined;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('SOTTO_ISOLATED_CLAUDE_IMAGE requires an immutable image digest');
  const selection = parseAgentModelId(model, 'claude-code');
  if (!selection?.model?.startsWith('claude-'))
    throw new Error(
      'Isolated Claude requires a canonical API model ID; CLI aliases are unsupported'
    );
  if (selection.effort === 'xhigh' || selection.effort === 'ultra')
    throw new Error('The selected effort is unsupported by the isolated Claude protocol');
  const credential = await sottoTransaction(
    prismaUnfiltered,
    (database) =>
      captureSottoExecutionCredential(
        database,
        execution.authorize,
        'ai',
        'anthropic',
        false,
        execution.signal
      ),
    { signal: execution.signal }
  );
  if (!credential || credential.recipient.userId !== userId || credential.selected.shared)
    throw new Error('Isolated Claude requires the learner’s personal Anthropic API credential');
  return {
    provider: 'claude-code',
    model,
    isolatedImage: image,
    endpoint: credential.binding.endpoint,
    apiKey: sottoExecutionCredentialFields(credential).apiKey,
    execution: { ...execution, userId, credential },
  };
}

/** Bind parent-only credentials and cleanup ownership to the captured preparation. */
export async function createCapturedIsolatedClaude(
  ai: CapturedLearningAi
): Promise<IsolatedClaudeExecution | undefined> {
  if (!ai.isolatedImage) return undefined;
  const workspace = ai.execution.isolatedWorkspace;
  if (!workspace)
    throw new Error('Isolated Claude requires a durable preparation execution workspace');
  if (
    ai.provider !== 'claude-code' ||
    ai.execution.credential?.provider !== 'anthropic' ||
    !ai.apiKey ||
    !ai.endpoint
  )
    throw new Error('The isolated Claude API credential binding is invalid');
  const admission = await captureSottoProviderAdmission(ai.execution);
  const base = new URL(ai.endpoint);
  if (base.search || base.hash)
    throw new Error('Isolated Claude endpoint cannot contain query parameters');
  const pathname = base.pathname.replace(/\/$/, '');
  base.pathname = pathname.endsWith('/v1') ? `${pathname}/messages` : `${pathname}/v1/messages`;
  const transport = admission.createTransport([{ method: 'POST', url: base.href }]);
  return {
    image: ai.isolatedImage,
    cliVersion: '2.1.283',
    executionId: randomUUID(),
    endpoint: base.href,
    credential: ai.apiKey,
    expiresAt: Date.now() + 10 * 60_000,
    maxOutputTokens: 16_384,
    admit: ({ signal }) => admission.validate(signal),
    authenticatedFetch: transport.authenticatedFetch,
    ...isolatedContainerJournal(workspace.directory),
    onCleanupError: (error) => {
      workspace.markCleanupUnconfirmed();
      ai.execution.onCleanupError?.(error);
    },
  };
}
