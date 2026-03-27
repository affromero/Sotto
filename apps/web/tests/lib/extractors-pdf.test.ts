import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('pdf extractor internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('extractPdfTables (via extractPdfContent)', () => {
    it('detects tab-separated table rows', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return {
              text: 'Name\tAge\tCity\nAlice\t30\tNYC\nBob\t25\tSF',
              pages: [],
              total: 1,
            };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.tables).toBeDefined();
      expect(result.tables!.length).toBe(1);
      expect(result.tables![0].headers).toEqual(['Name', 'Age', 'City']);
      expect(result.tables![0].rows).toHaveLength(2);
      expect(result.tables![0].rows[0]).toEqual(['Alice', '30', 'NYC']);
      expect(result.tables![0].rows[1]).toEqual(['Bob', '25', 'SF']);
    });

    it('detects multi-space-separated table rows', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return {
              text: 'Quarter    Revenue    Growth\nQ1    $10M    5%\nQ2    $12M    20%',
              pages: [],
              total: 1,
            };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.tables).toBeDefined();
      expect(result.tables!.length).toBe(1);
      expect(result.tables![0].headers).toContain('Quarter');
      expect(result.tables![0].headers).toContain('Revenue');
    });

    it('skips single-row data (needs at least 2 rows)', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return {
              text: 'Only\tOne\tRow',
              pages: [],
              total: 1,
            };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.tables).toBeUndefined();
    });

    it('flushes table when column count changes', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return {
              text: 'A\tB\tC\n1\t2\t3\n4\t5\t6\nX\tY\n7\t8',
              pages: [],
              total: 1,
            };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      // First table: 3 cols (A/B/C header + 2 data rows)
      // Second table: 2 cols (X/Y header + 1 data row) — also 2 rows total, so emitted
      expect(result.tables).toBeDefined();
      expect(result.tables!.length).toBe(2);
      expect(result.tables![0].headers).toEqual(['A', 'B', 'C']);
      expect(result.tables![0].rows).toHaveLength(2);
      expect(result.tables![1].headers).toEqual(['X', 'Y']);
      expect(result.tables![1].rows).toHaveLength(1);
    });

    it('does not include tables when text has no tabular data', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return {
              text: 'This is just a regular paragraph.\nWith normal lines.\nNothing tabular here.',
              pages: [],
              total: 1,
            };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.tables).toBeUndefined();
    });
  });

  describe('extractPdfFigures (via extractPdfContent)', () => {
    it('extracts figures from PDF pages with large enough images', async () => {
      const largeImageData = new Uint8Array(20000); // > MIN_IMAGE_BYTES (10000)
      largeImageData.fill(128);

      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'Content with images.', pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));

      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({
              getOperatorList: () => Promise.resolve({
                fnArray: [85], // OPS.paintImageXObject
                argsArray: [['img_0']],
              }),
              objs: {
                get: () => Promise.resolve({
                  data: largeImageData,
                  width: 100,
                  height: 50,
                }),
              },
            }),
          }),
        }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.figures).toBeDefined();
      expect(result.figures!.length).toBe(1);
      expect(result.figures![0].url).toMatch(/^data:image\/png;base64,/);
      expect(result.figures![0].caption).toBe('Figure from page 1');
      expect(result.figures![0].sourceLabel).toBe('Page 1');
      expect(result.figures![0].mimeType).toBe('image/png');
    });

    it('skips images smaller than MIN_IMAGE_BYTES', async () => {
      const tinyImageData = new Uint8Array(100); // < 10000

      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'Content.', pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));

      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({
              getOperatorList: () => Promise.resolve({
                fnArray: [85],
                argsArray: [['img_0']],
              }),
              objs: {
                get: () => Promise.resolve({
                  data: tinyImageData,
                  width: 5,
                  height: 5,
                }),
              },
            }),
          }),
        }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.figures).toBeUndefined();
    });

    it('continues without figures when pdfjs-dist fails', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'Content.', pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));

      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({
          promise: Promise.reject(new Error('pdfjs failed')),
        }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      // Should not throw — returns content without figures
      expect(result.text).toBe('Content.');
      expect(result.figures).toBeUndefined();
    });

    it('skips non-paintImageXObject operators', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'Content.', pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));

      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({
              getOperatorList: () => Promise.resolve({
                fnArray: [10, 20, 30], // Not 85 (paintImageXObject)
                argsArray: [[], [], []],
              }),
              objs: { get: vi.fn() },
            }),
          }),
        }),
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const result = await extractPdfContent(Buffer.from('fake-pdf'));

      expect(result.figures).toBeUndefined();
    });
  });
});
