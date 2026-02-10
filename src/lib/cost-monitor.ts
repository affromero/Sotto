/**
 * Per-provider cost tracking using the existing ApiUsageLog model.
 *
 * Aggregates costs from ApiUsageLog records grouped by service and category.
 * Provides daily, weekly, and monthly breakdowns for the admin dashboard.
 */

import { prisma } from './prisma';
import { logger } from './logger';

export interface ProviderCostBreakdown {
  service: string;
  totalCost: number;
  callCount: number;
  avgCostPerCall: number;
  categories: Array<{
    category: string;
    totalCost: number;
    callCount: number;
  }>;
}

export interface CostSummary {
  period: string;
  from: Date;
  to: Date;
  totalCost: number;
  providers: ProviderCostBreakdown[];
}

/**
 * Get cost breakdown by provider for a given time period.
 */
export async function getCostBreakdown(period: '24h' | '7d' | '30d' | '90d'): Promise<CostSummary> {
  const now = new Date();
  const periodMs: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
  };
  const from = new Date(now.getTime() - periodMs[period]);

  const logs = await prisma.apiUsageLog.groupBy({
    by: ['service', 'category'],
    where: { createdAt: { gte: from } },
    _sum: { totalCost: true },
    _count: { id: true },
  });

  // Group by service
  const serviceMap = new Map<
    string,
    {
      totalCost: number;
      callCount: number;
      categories: Map<string, { totalCost: number; callCount: number }>;
    }
  >();

  for (const row of logs) {
    const svc = row.service;
    if (!serviceMap.has(svc)) {
      serviceMap.set(svc, { totalCost: 0, callCount: 0, categories: new Map() });
    }
    const entry = serviceMap.get(svc)!;
    const cost = row._sum.totalCost ?? 0;
    const count = row._count.id;
    entry.totalCost += cost;
    entry.callCount += count;
    entry.categories.set(row.category, { totalCost: cost, callCount: count });
  }

  let totalCost = 0;
  const providers: ProviderCostBreakdown[] = [];
  for (const [service, data] of serviceMap) {
    totalCost += data.totalCost;
    providers.push({
      service,
      totalCost: data.totalCost,
      callCount: data.callCount,
      avgCostPerCall: data.callCount > 0 ? data.totalCost / data.callCount : 0,
      categories: Array.from(data.categories.entries()).map(([category, cat]) => ({
        category,
        totalCost: cat.totalCost,
        callCount: cat.callCount,
      })),
    });
  }

  // Sort by cost descending
  providers.sort((a, b) => b.totalCost - a.totalCost);

  return { period, from, to: now, totalCost, providers };
}

/**
 * Get daily cost trend for a given number of days.
 */
export async function getDailyCostTrend(
  days: number = 30
): Promise<Array<{ date: string; totalCost: number; services: Record<string, number> }>> {
  const from = new Date();
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  const logs = await prisma.apiUsageLog.findMany({
    where: { createdAt: { gte: from } },
    select: { service: true, totalCost: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // Bucket by date
  const buckets = new Map<string, { totalCost: number; services: Map<string, number> }>();

  for (const log of logs) {
    const dateKey = log.createdAt.toISOString().split('T')[0];
    if (!buckets.has(dateKey)) {
      buckets.set(dateKey, { totalCost: 0, services: new Map() });
    }
    const bucket = buckets.get(dateKey)!;
    bucket.totalCost += log.totalCost;
    const prev = bucket.services.get(log.service) ?? 0;
    bucket.services.set(log.service, prev + log.totalCost);
  }

  return Array.from(buckets.entries()).map(([date, data]) => ({
    date,
    totalCost: data.totalCost,
    services: Object.fromEntries(data.services),
  }));
}

/**
 * Check if costs are approaching a threshold.
 * Returns warnings for any provider whose daily spend exceeds the threshold.
 */
export async function checkCostThresholds(
  dailyThreshold: number = 50
): Promise<Array<{ service: string; dailyCost: number; threshold: number }>> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const logs = await prisma.apiUsageLog.groupBy({
    by: ['service'],
    where: { createdAt: { gte: yesterday } },
    _sum: { totalCost: true },
  });

  const warnings: Array<{ service: string; dailyCost: number; threshold: number }> = [];
  for (const row of logs) {
    const cost = row._sum.totalCost ?? 0;
    if (cost >= dailyThreshold) {
      warnings.push({ service: row.service, dailyCost: cost, threshold: dailyThreshold });
      logger.warn('Cost threshold exceeded', {
        service: row.service,
        dailyCost: String(cost.toFixed(2)),
        threshold: String(dailyThreshold),
      });
    }
  }

  return warnings;
}
