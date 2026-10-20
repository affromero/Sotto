import { pdfRuntime } from '../../../../scripts/pdf-render/runtime.mjs';

export async function createPdfParser(data: Uint8Array) {
  const { options, canvases } = pdfRuntime(data);
  const { PDFParse } = await import('pdf-parse');
  return { parser: new PDFParse(options), releaseCanvases: canvases.release };
}
