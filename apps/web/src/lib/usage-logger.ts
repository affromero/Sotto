/**
 * Unified API usage logger — single entry point for all provider cost tracking.
 * Replaces the old logApiUsage() from claude.ts with proper model-aware cost computation.
 */
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from './prisma';
import { getAiCost } from './pricing';
import { logger } from './logger';
import { getAiProviderIdsWithPricing } from './providers/ai-registry';
import { knownTokenSum } from 'thesidedoor-core/ai/usage';
import { metricEventSchema } from 'thesidedoor-core/observability';
import { randomUUID } from 'node:crypto';
import { formatAgentModelId, parseAgentModelId } from './agent-models/id';

const AI_SERVICES: Set<string> = new Set(getAiProviderIdsWithPricing());

export async function logUsage(params: {
  service: string;
  model?: string;
  category: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalCost?: number | null;
  episodeId?: string;
  userId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  for (const count of [params.inputTokens, params.outputTokens]) {
    if (count != null && knownTokenSum(count) === null)
      throw new Error('Usage token counts must be nonnegative safe integers or unknown');
  }
  if (params.totalCost != null && (!Number.isFinite(params.totalCost) || params.totalCost < 0))
    throw new Error('Usage cost must be finite and nonnegative or unknown');
  let totalCost = params.totalCost;

  if (
    totalCost === undefined &&
    params.service !== 'claude-code' &&
    params.service !== 'codex' &&
    AI_SERVICES.has(params.service) &&
    params.model
  ) {
    totalCost = getAiCost(params.model, params.inputTokens, params.outputTokens);
  }

  try {
    const agentSelection =
      params.model && (params.service === 'codex' || params.service === 'claude-code')
        ? parseAgentModelId(params.model, params.service)
        : null;
    if (params.model && (params.service === 'codex' || params.service === 'claude-code')) {
      if (!agentSelection || agentSelection.provider !== params.service)
        throw new Error('Usage model must match its CLI provider');
      const canonical = formatAgentModelId(
        agentSelection.provider,
        agentSelection.model,
        agentSelection.effort
      );
      if (
        params.model !== canonical &&
        (!agentSelection.model || params.model !== canonical.slice(params.service.length + 1))
      )
        throw new Error('Usage model must be a canonical CLI selection');
    }
    const metricModel = agentSelection ? (agentSelection.model ?? params.service) : params.model;
    const metric = metricEventSchema.parse({
      version: 1,
      id: randomUUID(),
      timestamp: Date.now(),
      kind: 'execution',
      operation: params.category,
      outcome: 'success',
      provider: params.service,
      ...(metricModel ? { model: metricModel } : {}),
      ...(params.userId ? { consumerId: params.userId } : {}),
      durationMs: params.durationMs ?? null,
      inputTokens: params.inputTokens ?? null,
      outputTokens: params.outputTokens ?? null,
      estimatedCost: totalCost ?? null,
      ...(totalCost == null ? {} : { currency: 'USD' }),
    });
    await prisma.apiUsageLog
      .create({
        data: {
          service: params.service,
          modelId: params.model ?? null,
          category: params.category,
          inputTokens: params.inputTokens ?? null,
          outputTokens: params.outputTokens ?? null,
          totalCost: totalCost ?? null,
          durationMs: params.durationMs ?? null,
          episodeId: params.episodeId ?? null,
          userId: params.userId ?? null,
          metadata: {
            ...(params.metadata ?? {}),
            ...(agentSelection ? { agentModelSelection: { ...agentSelection } } : {}),
            sidedoorMetric: metric,
          } as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        logger.warn('logUsage: failed to write ApiUsageLog', {
          category: params.category,
          service: params.service,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  } catch (err) {
    logger.warn('logUsage: unexpected error creating ApiUsageLog', {
      category: params.category,
      service: params.service,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
