import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { estimateCosts, isR2MonitoringConfigured, classifyAction } from '@/lib/cloudflare-r2-usage';
import type { R2BucketUsage, R2OperationCounts } from '@/lib/cloudflare-r2-usage';

describe('cloudflare-r2-usage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isR2MonitoringConfigured', () => {
    it('returns false when both env vars are missing', () => {
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.CF_API_TOKEN;
      expect(isR2MonitoringConfigured()).toBe(false);
    });

    it('returns false when only R2_ACCOUNT_ID is set', () => {
      process.env.R2_ACCOUNT_ID = 'test-account';
      delete process.env.CF_API_TOKEN;
      expect(isR2MonitoringConfigured()).toBe(false);
    });

    it('returns false when only CF_API_TOKEN is set', () => {
      delete process.env.R2_ACCOUNT_ID;
      process.env.CF_API_TOKEN = 'test-token';
      expect(isR2MonitoringConfigured()).toBe(false);
    });

    it('returns true when both env vars are set', () => {
      process.env.R2_ACCOUNT_ID = 'test-account';
      process.env.CF_API_TOKEN = 'test-token';
      expect(isR2MonitoringConfigured()).toBe(true);
    });
  });

  describe('classifyAction', () => {
    it('classifies PutObject as Class A', () => {
      expect(classifyAction('PutObject')).toBe('A');
    });

    it('classifies CompleteMultipartUpload as Class A', () => {
      expect(classifyAction('CompleteMultipartUpload')).toBe('A');
    });

    it('classifies GetObject as Class B', () => {
      expect(classifyAction('GetObject')).toBe('B');
    });

    it('classifies HeadObject as Class B', () => {
      expect(classifyAction('HeadObject')).toBe('B');
    });

    it('classifies ListObjects as free', () => {
      expect(classifyAction('ListObjects')).toBe('free');
    });

    it('classifies DeleteObject as free', () => {
      expect(classifyAction('DeleteObject')).toBe('free');
    });

    it('classifies unknown actions as Class B (conservative)', () => {
      expect(classifyAction('SomeNewAction')).toBe('B');
    });
  });

  describe('estimateCosts', () => {
    it('returns zero costs when under free tier', () => {
      const usage: R2BucketUsage = {
        payloadSizeBytes: 5 * 1024 ** 3, // 5 GB
        metadataSizeBytes: 0,
        objectCount: 100,
        uploadCount: 0,
      };
      const ops: R2OperationCounts = {
        classAOps: 500_000,   // under 1M free
        classBOps: 5_000_000, // under 10M free
        freeOps: 1000,
      };

      const costs = estimateCosts(usage, ops);

      expect(costs.storageCostEstimate).toBe(0);
      expect(costs.classACostEstimate).toBe(0);
      expect(costs.classBCostEstimate).toBe(0);
      expect(costs.totalCostEstimate).toBe(0);
    });

    it('returns zero costs at exact free tier boundary', () => {
      const usage: R2BucketUsage = {
        payloadSizeBytes: 10 * 1024 ** 3, // exactly 10 GB
        metadataSizeBytes: 0,
        objectCount: 100,
        uploadCount: 0,
      };
      const ops: R2OperationCounts = {
        classAOps: 1_000_000,  // exactly 1M
        classBOps: 10_000_000, // exactly 10M
        freeOps: 0,
      };

      const costs = estimateCosts(usage, ops);

      expect(costs.storageCostEstimate).toBe(0);
      expect(costs.classACostEstimate).toBe(0);
      expect(costs.classBCostEstimate).toBe(0);
      expect(costs.totalCostEstimate).toBe(0);
    });

    it('calculates costs correctly above free tier', () => {
      const usage: R2BucketUsage = {
        payloadSizeBytes: 20 * 1024 ** 3, // 20 GB (10 GB billable)
        metadataSizeBytes: 0,
        objectCount: 1000,
        uploadCount: 0,
      };
      const ops: R2OperationCounts = {
        classAOps: 2_000_000,  // 1M billable
        classBOps: 20_000_000, // 10M billable
        freeOps: 5000,
      };

      const costs = estimateCosts(usage, ops);

      // Storage: 10 GB * $0.015/GB = $0.15
      expect(costs.storageCostEstimate).toBeCloseTo(0.15, 4);
      // Class A: 1M * $4.50/M = $4.50
      expect(costs.classACostEstimate).toBeCloseTo(4.5, 4);
      // Class B: 10M * $0.36/M = $3.60
      expect(costs.classBCostEstimate).toBeCloseTo(3.6, 4);
      // Total
      expect(costs.totalCostEstimate).toBeCloseTo(8.25, 4);
    });

    it('includes metadata size in storage calculation', () => {
      const usage: R2BucketUsage = {
        payloadSizeBytes: 8 * 1024 ** 3,  // 8 GB
        metadataSizeBytes: 4 * 1024 ** 3, // 4 GB metadata
        objectCount: 100,
        uploadCount: 0,
      };
      const ops: R2OperationCounts = {
        classAOps: 0,
        classBOps: 0,
        freeOps: 0,
      };

      const costs = estimateCosts(usage, ops);

      // Total: 12 GB, 2 GB billable at $0.015/GB = $0.03
      expect(costs.storageCostEstimate).toBeCloseTo(0.03, 4);
    });
  });
});
