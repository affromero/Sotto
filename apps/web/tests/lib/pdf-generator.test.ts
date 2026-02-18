import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReferenceData } from '@/types/reference';

// ---- Mocks ----

const mockGetBuffer = vi.fn();
const mockCreatePdf = vi.fn();

vi.mock('pdfmake', () => ({
  createPdf: (...args: unknown[]) => mockCreatePdf(...args),
}));

// ---- Import under test ----
import { generatePodcastPdf } from '@/lib/pdf-generator';

// ---- Tests ----

describe('pdf-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreatePdf.mockReturnValue({
      getBuffer: mockGetBuffer,
    });
  });

  describe('basic PDF generation', () => {
    it('generates a valid PDF buffer', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // %PDF header
      });

      const data = {
        title: 'Test Podcast Title',
        topic: 'Test Topic',
        creatorName: 'John Doe',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('rejects when pdfmake throws error', async () => {
      mockCreatePdf.mockImplementation(() => {
        throw new Error('PDF generation failed');
      });

      const data = {
        title: 'Error Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      await expect(generatePodcastPdf(data)).rejects.toThrow('PDF generation failed');
    });

    it('handles references without optional fields', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-minimal',
          number: 1,
          title: 'Minimal Reference',
          authors: [],
          year: null,
          url: null,
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'Minimal Reference Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
    });

  });
});
