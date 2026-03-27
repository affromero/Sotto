import { describe, it, expect } from 'vitest';
import { encodeImageToDataUri } from '@/lib/extractors/pdf-image-utils';

describe('pdf-image-utils', () => {
  describe('encodeImageToDataUri', () => {
    it('returns null when data is missing', () => {
      expect(encodeImageToDataUri({ data: null as unknown as Uint8Array, width: 10, height: 10 })).toBeNull();
    });

    it('returns null when width is zero', () => {
      const data = new Uint8Array(40); // 10 pixels RGBA = 40 bytes but width=0
      expect(encodeImageToDataUri({ data, width: 0, height: 10 })).toBeNull();
    });

    it('returns null when height is zero', () => {
      const data = new Uint8Array(40);
      expect(encodeImageToDataUri({ data, width: 10, height: 0 })).toBeNull();
    });

    it('encodes a 1x1 RGBA pixel to a valid PNG data URI', () => {
      // 1x1 red pixel: RGBA = [255, 0, 0, 255]
      const data = new Uint8Array([255, 0, 0, 255]);
      const result = encodeImageToDataUri({ data, width: 1, height: 1 });

      expect(result).not.toBeNull();
      expect(result).toMatch(/^data:image\/png;base64,/);

      // Decode and verify PNG signature
      const base64 = result!.replace('data:image/png;base64,', '');
      const pngBuffer = Buffer.from(base64, 'base64');

      // PNG signature: 137 80 78 71 13 10 26 10
      expect(pngBuffer[0]).toBe(137);
      expect(pngBuffer[1]).toBe(80);  // P
      expect(pngBuffer[2]).toBe(78);  // N
      expect(pngBuffer[3]).toBe(71);  // G
    });

    it('encodes a 2x2 image with correct dimensions in IHDR', () => {
      // 2x2 RGBA = 16 bytes
      const data = new Uint8Array(16);
      data.fill(128); // grey semi-transparent
      const result = encodeImageToDataUri({ data, width: 2, height: 2 });

      expect(result).not.toBeNull();

      const base64 = result!.replace('data:image/png;base64,', '');
      const pngBuffer = Buffer.from(base64, 'base64');

      // After PNG signature (8 bytes) + IHDR chunk length (4 bytes) + 'IHDR' (4 bytes) = offset 16
      // IHDR data: width (4 bytes) + height (4 bytes)
      const view = new DataView(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength);
      const ihdrWidth = view.getUint32(16);
      const ihdrHeight = view.getUint32(20);

      expect(ihdrWidth).toBe(2);
      expect(ihdrHeight).toBe(2);
    });

    it('encodes a larger image without throwing', () => {
      // 10x10 RGBA = 400 bytes
      const data = new Uint8Array(400);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = i % 256;       // R
        data[i + 1] = 128;       // G
        data[i + 2] = 255;       // B
        data[i + 3] = 255;       // A
      }

      const result = encodeImageToDataUri({ data, width: 10, height: 10 });

      expect(result).not.toBeNull();
      expect(result).toMatch(/^data:image\/png;base64,/);
      // Result should be a valid base64 string with reasonable length
      const base64 = result!.replace('data:image/png;base64,', '');
      expect(base64.length).toBeGreaterThan(0);
    });

    it('contains IHDR, IDAT, and IEND chunks', () => {
      const data = new Uint8Array([255, 0, 0, 255]);
      const result = encodeImageToDataUri({ data, width: 1, height: 1 });

      const pngBuffer = Buffer.from(result!.replace('data:image/png;base64,', ''), 'base64');
      const pngString = pngBuffer.toString('latin1');

      expect(pngString).toContain('IHDR');
      expect(pngString).toContain('IDAT');
      expect(pngString).toContain('IEND');
    });

    it('sets IHDR color type to 6 (RGBA) and bit depth to 8', () => {
      const data = new Uint8Array([0, 0, 0, 255]);
      const result = encodeImageToDataUri({ data, width: 1, height: 1 });

      const pngBuffer = Buffer.from(result!.replace('data:image/png;base64,', ''), 'base64');

      // IHDR data starts at offset 16 (8 sig + 4 length + 4 type)
      // Bit depth at offset 16+8 = 24, color type at 16+9 = 25
      expect(pngBuffer[24]).toBe(8);  // bit depth
      expect(pngBuffer[25]).toBe(6);  // color type: RGBA
    });
  });
});
