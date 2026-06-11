/**
 * Unified API usage logger — single entry point for all provider cost tracking.
 * Replaces the old logApiUsage() from claude.ts with proper model-aware cost computation.
 */
import { prisma } from './prisma';
import { getAiCost } from './pricing';
import { logger } from './logger';
import { getAiProviderIdsWithPricing } from './providers/ai-registry';

const AI_SERVICES: Set<string> = new Set(getAiProviderIdsWithPricing());

export async function logUsage(params: {
  service: string;
  model?: string;
  category: string;
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  podcastId?: string;
  userId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  let totalCost = params.totalCost;

  if (totalCost === undefined && AI_SERVICES.has(params.service) && params.model) {
    totalCost = getAiCost(params.model, params.inputTokens ?? 0, params.outputTokens ?? 0);
  }

  try {
    prisma.apiUsageLog
      .create({
        data: {
          service: params.service,
          modelId: params.model ?? null,
          category: params.category,
          inputTokens: params.inputTokens ?? null,
          outputTokens: params.outputTokens ?? null,
          totalCost: totalCost ?? 0,
          durationMs: params.durationMs ?? null,
          podcastId: params.podcastId ?? null,
          userId: params.userId ?? null,
          metadata: params.metadata ?? {},
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
