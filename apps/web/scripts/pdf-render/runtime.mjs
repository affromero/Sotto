// @ts-check
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { ownedPdfCanvases } from './canvas.mjs';

/** Resolve the parser's paired renderer, assets and native binding. @param {Uint8Array} data */
export function pdfRuntime(data) {
  const applicationRequire = createRequire(join(process.cwd(), 'package.json'));
  const parserRequire = createRequire(applicationRequire.resolve('pdf-parse'));
  const assets = dirname(parserRequire.resolve('pdfjs-dist/package.json'));
  const pdfRequire = createRequire(join(assets, 'package.json'));
  const canvas = /** @type {typeof import('@napi-rs/canvas')} */ (pdfRequire('@napi-rs/canvas'));
  const canvases = ownedPdfCanvases(canvas.createCanvas);
  return {
    assets,
    canvases,
    options: {
      data: new Uint8Array(data),
      CanvasFactory: canvases.CanvasFactory,
      standardFontDataUrl: join(assets, 'standard_fonts') + sep,
      cMapUrl: join(assets, 'cmaps') + sep,
      cMapPacked: true,
      wasmUrl: join(assets, 'wasm') + sep,
      verbosity: 0,
    },
  };
}
