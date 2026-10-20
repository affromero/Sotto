import type { MaterialFocusAnalysisCoverage } from '@sotto/shared';

export const completeMaterialCoverage: MaterialFocusAnalysisCoverage = {
  expectedChunks: 1,
  analyzedChunks: 1,
  expectedCodePoints: 100,
  analyzedCodePoints: 100,
  pendingUnitIds: [],
  failedUnitIds: [],
  emptyStreams: [],
  unresolvedPages: [],
  readableTextComplete: true,
  originalContentComplete: true,
  sufficientSource: true,
  status: 'COMPLETE',
};
export const partialMaterialCoverage: MaterialFocusAnalysisCoverage = {
  expectedChunks: 2,
  analyzedChunks: 1,
  expectedCodePoints: 100,
  analyzedCodePoints: 50,
  pendingUnitIds: [],
  failedUnitIds: ['c'.repeat(64)],
  emptyStreams: [],
  unresolvedPages: [{ sourceId: 'fixture-source', pageNumber: 1, state: 'UNAVAILABLE' }],
  readableTextComplete: false,
  originalContentComplete: false,
  sufficientSource: true,
  status: 'INCOMPLETE',
};
