import type { Page } from 'playwright';

export interface FlowScenario {
  name: string;
  description: string;
  viewport: { width: number; height: number };
  auth: 'none' | 'demo' | 'admin';
  run: (page: Page, ctx: FlowContext) => Promise<void>;
}

export interface FlowContext {
  appUrl: string;
  demoUser: { id: string; email: string };
  demoPodcasts: Record<string, { id: string; title: string }>;
  tokens: Record<string, string>;
}

export interface GradeOptions {
  input: string;
  outputDir: string;
  name: string;
  formats: OutputFormat[];
}

export type OutputFormat = 'mp4' | 'hevc' | 'webm' | 'gif';

export interface GradeResult {
  format: OutputFormat;
  path: string;
  sizeBytes: number;
}

export interface RecordingManifest {
  createdAt: string;
  appUrl: string;
  flows: FlowManifestEntry[];
}

export interface FlowManifestEntry {
  name: string;
  description: string;
  rawPath: string;
  outputs: GradeResult[];
}
