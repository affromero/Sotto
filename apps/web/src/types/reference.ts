import { ReferenceType, VerificationStatus } from '@prisma/client';

export interface VerificationLayerResult {
  layer: string;
  passed: boolean;
  details?: string;
}

export interface ReferenceData {
  id: string;
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  type: ReferenceType;
  publisher: string | null;
  doi: string | null;
  verificationStatus: VerificationStatus;
  verificationDetails: Record<string, unknown> | null;
  contentDomain: string | null;
}
