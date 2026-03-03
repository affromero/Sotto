import { prisma } from './prisma';

export interface StorageOverview {
  bucket: string;
  payloadSizeBytes: number;
  metadataSizeBytes: number;
  objectCount: number;
  uploadCount: number;
  classAOps: number;
  classBOps: number;
  freeOps: number;
  storageCostEstimate: number;
  classACostEstimate: number;
  classBCostEstimate: number;
  totalCostEstimate: number;
  createdAt: Date;
}

export interface StorageTrendPoint {
  date: string;
  payloadSizeGb: number;
  objectCount: number;
  totalCost: number;
  storageCost: number;
  opsCost: number;
}

export interface StorageAlert {
  level: 'warn' | 'alert';
  message: string;
  currentCost: number;
  threshold: number;
}

export async function getStorageOverview(): Promise<StorageOverview | null> {
  const snapshot = await prisma.r2UsageSnapshot.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!snapshot) return null;

  return {
    bucket: snapshot.bucket,
    payloadSizeBytes: snapshot.payloadSizeBytes,
    metadataSizeBytes: snapshot.metadataSizeBytes,
    objectCount: snapshot.objectCount,
    uploadCount: snapshot.uploadCount,
    classAOps: snapshot.classAOps,
    classBOps: snapshot.classBOps,
    freeOps: snapshot.freeOps,
    storageCostEstimate: snapshot.storageCostEstimate,
    classACostEstimate: snapshot.classACostEstimate,
    classBCostEstimate: snapshot.classBCostEstimate,
    totalCostEstimate: snapshot.totalCostEstimate,
    createdAt: snapshot.createdAt,
  };
}

export async function getStorageTrend(days = 30): Promise<StorageTrendPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snapshots = await prisma.r2UsageSnapshot.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      payloadSizeBytes: true,
      metadataSizeBytes: true,
      objectCount: true,
      storageCostEstimate: true,
      classACostEstimate: true,
      classBCostEstimate: true,
      totalCostEstimate: true,
    },
  });

  // Group by date (take latest snapshot per day)
  const byDate = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    const date = s.createdAt.toISOString().slice(0, 10);
    byDate.set(date, s); // last one wins (latest in day)
  }

  return Array.from(byDate.entries()).map(([date, s]) => ({
    date,
    payloadSizeGb: (s.payloadSizeBytes + s.metadataSizeBytes) / (1024 ** 3),
    objectCount: s.objectCount,
    totalCost: s.totalCostEstimate,
    storageCost: s.storageCostEstimate,
    opsCost: s.classACostEstimate + s.classBCostEstimate,
  }));
}

export function checkStorageAlerts(
  overview: StorageOverview | null,
  warnAt = 5,
  alertAt = 20,
): StorageAlert[] {
  if (!overview) return [];

  const alerts: StorageAlert[] = [];
  const cost = overview.totalCostEstimate;

  if (cost >= alertAt) {
    alerts.push({
      level: 'alert',
      message: `R2 estimated monthly cost is $${cost.toFixed(2)}, exceeding $${alertAt} alert threshold`,
      currentCost: cost,
      threshold: alertAt,
    });
  } else if (cost >= warnAt) {
    alerts.push({
      level: 'warn',
      message: `R2 estimated monthly cost is $${cost.toFixed(2)}, approaching $${warnAt} warning threshold`,
      currentCost: cost,
      threshold: warnAt,
    });
  }

  return alerts;
}
