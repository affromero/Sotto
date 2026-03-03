import { logger } from './logger';

// R2 pricing (as of 2024): https://developers.cloudflare.com/r2/pricing/
const STORAGE_FREE_GB = 10;
const STORAGE_COST_PER_GB = 0.015;
const CLASS_A_FREE = 1_000_000;
const CLASS_A_COST_PER_MILLION = 4.5;
const CLASS_B_FREE = 10_000_000;
const CLASS_B_COST_PER_MILLION = 0.36;

// Class A operations (mutating)
const CLASS_A_ACTIONS = new Set([
  'PutObject', 'CopyObject', 'CompleteMultipartUpload',
  'CreateMultipartUpload', 'UploadPart', 'UploadPartCopy',
  'ListParts', 'PutBucketCors', 'PutBucketLifecycleConfiguration',
  'CreateBucket', 'ListMultipartUploads',
]);

// Class B operations (read)
const CLASS_B_ACTIONS = new Set([
  'GetObject', 'HeadObject', 'GetBucketCors',
  'GetBucketLifecycleConfiguration', 'HeadBucket',
  'GetBucketLocation', 'GetBucketVersioning',
]);

// Free operations
const FREE_ACTIONS = new Set([
  'ListBuckets', 'ListObjects', 'ListObjectsV2',
  'DeleteObject', 'DeleteObjects', 'AbortMultipartUpload',
]);

export interface R2BucketUsage {
  payloadSizeBytes: number;
  metadataSizeBytes: number;
  objectCount: number;
  uploadCount: number;
}

export interface R2OperationCounts {
  classAOps: number;
  classBOps: number;
  freeOps: number;
}

export interface R2CostEstimate {
  storageCostEstimate: number;
  classACostEstimate: number;
  classBCostEstimate: number;
  totalCostEstimate: number;
}

export interface R2UsageData {
  usage: R2BucketUsage;
  ops: R2OperationCounts;
  costs: R2CostEstimate;
}

export function isR2MonitoringConfigured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.CF_API_TOKEN);
}

function getAccountId(): string {
  const id = process.env.R2_ACCOUNT_ID;
  if (!id) throw new Error('R2_ACCOUNT_ID is not set');
  return id;
}

function getApiToken(): string {
  const token = process.env.CF_API_TOKEN;
  if (!token) throw new Error('CF_API_TOKEN is not set');
  return token;
}

export async function fetchBucketUsage(bucket: string): Promise<R2BucketUsage> {
  const accountId = getAccountId();
  const token = getApiToken();

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/usage`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cloudflare R2 usage API returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as {
    result: {
      payloadSize: number;
      metadataSize: number;
      objectCount: number;
      uploadCount: number;
    };
  };

  return {
    payloadSizeBytes: json.result.payloadSize,
    metadataSizeBytes: json.result.metadataSize,
    objectCount: json.result.objectCount,
    uploadCount: json.result.uploadCount,
  };
}

export async function fetchOperationCounts(
  bucket: string,
  since: Date,
  until: Date,
): Promise<R2OperationCounts> {
  const accountId = getAccountId();
  const token = getApiToken();

  const query = `
    query R2Operations($accountId: String!, $since: Time!, $until: Time!, $bucket: String!) {
      viewer {
        accounts(filter: { accountTag: $accountId }) {
          r2OperationsAdaptiveGroups(
            filter: { datetime_geq: $since, datetime_lt: $until, bucketName: $bucket }
            limit: 10000
          ) {
            dimensions { actionType }
            sum { requests }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        accountId,
        since: since.toISOString(),
        until: until.toISOString(),
        bucket,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cloudflare GraphQL API returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as {
    data: {
      viewer: {
        accounts: Array<{
          r2OperationsAdaptiveGroups: Array<{
            dimensions: { actionType: string };
            sum: { requests: number };
          }>;
        }>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Cloudflare GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
  }

  const groups = json.data.viewer.accounts[0]?.r2OperationsAdaptiveGroups ?? [];

  let classAOps = 0;
  let classBOps = 0;
  let freeOps = 0;

  for (const group of groups) {
    const action = group.dimensions.actionType;
    const count = group.sum.requests;

    if (CLASS_A_ACTIONS.has(action)) {
      classAOps += count;
    } else if (CLASS_B_ACTIONS.has(action)) {
      classBOps += count;
    } else if (FREE_ACTIONS.has(action)) {
      freeOps += count;
    } else {
      // Unknown action — classify as Class B (read-like) to be conservative
      classBOps += count;
      logger.warn('Unknown R2 action type, classified as Class B', { action, count: String(count) });
    }
  }

  return { classAOps, classBOps, freeOps };
}

export function classifyAction(action: string): 'A' | 'B' | 'free' {
  if (CLASS_A_ACTIONS.has(action)) return 'A';
  if (CLASS_B_ACTIONS.has(action)) return 'B';
  if (FREE_ACTIONS.has(action)) return 'free';
  return 'B'; // conservative default
}

export function estimateCosts(
  usage: R2BucketUsage,
  ops: R2OperationCounts,
): R2CostEstimate {
  const totalSizeGb = (usage.payloadSizeBytes + usage.metadataSizeBytes) / (1024 ** 3);
  const billableGb = Math.max(0, totalSizeGb - STORAGE_FREE_GB);
  const storageCostEstimate = billableGb * STORAGE_COST_PER_GB;

  const billableClassA = Math.max(0, ops.classAOps - CLASS_A_FREE);
  const classACostEstimate = (billableClassA / 1_000_000) * CLASS_A_COST_PER_MILLION;

  const billableClassB = Math.max(0, ops.classBOps - CLASS_B_FREE);
  const classBCostEstimate = (billableClassB / 1_000_000) * CLASS_B_COST_PER_MILLION;

  const totalCostEstimate = storageCostEstimate + classACostEstimate + classBCostEstimate;

  return { storageCostEstimate, classACostEstimate, classBCostEstimate, totalCostEstimate };
}

export async function fetchR2UsageData(bucket: string): Promise<R2UsageData> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago

  const [usage, ops] = await Promise.all([
    fetchBucketUsage(bucket),
    fetchOperationCounts(bucket, since, now),
  ]);

  const costs = estimateCosts(usage, ops);

  return { usage, ops, costs };
}
