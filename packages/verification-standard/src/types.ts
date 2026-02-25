export type ContentDomain = 'ACADEMIC' | 'NEWS' | 'GOVERNMENT' | 'GENERAL';

// Must match the layer IDs used in reference-validator.ts: 'doi', 'title_search', 'url', 'ai'
export type LayerId = 'doi' | 'title_search' | 'url' | 'ai';

export interface LayerResult {
  layerId: LayerId;
  passed: boolean;
  confidence: number; // 0.0–1.0
}

export interface LayerConfig {
  id: LayerId;
  weight: number; // normalized among applicable layers, sums to 1.0
  description: string;
}

export interface DomainConfig {
  domain: ContentDomain;
  label: string;
  description: string;
  layers: LayerConfig[];
  threshold: number; // minimum weighted score to VERIFY
  aiInstruction: string; // injected into AI evaluator prompt
  urlPatterns?: RegExp[]; // URL patterns that hint at this domain
  typePatterns?: string[]; // ReferenceType values that hint at this domain
}

export interface VerificationPrinciple {
  id: string;
  title: string;
  description: string;
}
