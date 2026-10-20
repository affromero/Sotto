// @ts-check
/** @typedef {import('@napi-rs/canvas').Canvas} Canvas */
/** @typedef {{canvas: Canvas | null, context: import('@napi-rs/canvas').SKRSContext2D | null}} CanvasPair */

/** @param {(width: number, height: number) => Canvas} createCanvas */
export function ownedPdfCanvases(createCanvas) {
  /** @type {Set<CanvasPair>} */
  const live = new Set();
  /** @param {CanvasPair} pair */
  const destroy = (pair) => {
    if (pair.canvas) {
      pair.canvas.width = 0;
      pair.canvas.height = 0;
      pair.canvas = null;
      pair.context = null;
    }
    live.delete(pair);
  };
  class CanvasFactory {
    /** @param {number} width @param {number} height @returns {CanvasPair} */
    create(width, height) {
      if (width <= 0 || height <= 0) throw new Error('Invalid PDF canvas dimensions.');
      const canvas = createCanvas(width, height);
      const pair = { canvas, context: canvas.getContext('2d') };
      live.add(pair);
      return pair;
    }
    /** @param {CanvasPair} pair @param {number} width @param {number} height */
    reset(pair, width, height) {
      if (!pair.canvas || width <= 0 || height <= 0) throw new Error('Invalid PDF canvas reset.');
      pair.canvas.width = width;
      pair.canvas.height = height;
    }
    /** @param {CanvasPair} pair */
    destroy(pair) {
      destroy(pair);
    }
  }
  return {
    CanvasFactory,
    encodeJpeg: async () => {
      const pairs = [...live];
      if (pairs.length !== 1 || !pairs[0]?.canvas)
        throw new Error('The original PDF page canvas is unavailable.');
      return pairs[0].canvas.encode('jpeg', 85);
    },
    release: () => {
      for (const pair of live) destroy(pair);
    },
  };
}
