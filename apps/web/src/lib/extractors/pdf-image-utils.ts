/**
 * Encode raw PDF image object data to a PNG data URI.
 * Used by the PDF extractor to capture embedded figures.
 */
export function encodeImageToDataUri(img: {
  data: Uint8Array;
  width: number;
  height: number;
}): string | null {
  if (!img.data || !img.width || !img.height) return null;

  // The raw data from pdfjs is RGBA pixel data — encode as raw PNG
  try {
    const { width, height, data } = img;
    const png = encodePng(data, width, height);
    return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Minimal PNG encoder for RGBA pixel data.
 * No external dependency — produces valid PNG from raw pixels.
 */
function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const { deflateSync } = require('zlib') as typeof import('zlib');

  // Build raw image data with filter byte (0 = None) per row
  const rowBytes = width * 4 + 1;
  const rawData = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    rawData[y * rowBytes] = 0; // filter: None
    rawData.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * rowBytes + 1);
  }

  const compressed = deflateSync(Buffer.from(rawData));

  // PNG file structure
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = createChunk('IHDR', encodeIHDR(width, height));
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', new Uint8Array(0));

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  result.set(signature, offset);
  offset += signature.length;
  result.set(ihdr, offset);
  offset += ihdr.length;
  result.set(idat, offset);
  offset += idat.length;
  result.set(iend, offset);

  return result;
}

function encodeIHDR(width: number, height: number): Uint8Array {
  const buf = new ArrayBuffer(13);
  const view = new DataView(buf);
  view.setUint32(0, width);
  view.setUint32(4, height);
  view.setUint8(8, 8); // bit depth
  view.setUint8(9, 6); // color type: RGBA
  view.setUint8(10, 0); // compression
  view.setUint8(11, 0); // filter
  view.setUint8(12, 0); // interlace
  return new Uint8Array(buf);
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);

  // Length
  view.setUint32(0, data.length);

  // Type
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }

  // Data
  chunk.set(data, 8);

  // CRC32 over type + data
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);

  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
