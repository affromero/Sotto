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

  describe('segments and references', () => {
    it('generates PDF with segments successfully', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Segment Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'Welcome to the podcast!' },
          { speaker: 'EXPERT' as const, text: 'Thanks for having me.' },
          { speaker: 'HOST' as const, text: 'Let us discuss the topic.' },
        ],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('generates PDF with references successfully', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-1',
          number: 1,
          title: 'Research Paper Title',
          authors: ['Smith, J.', 'Doe, A.'],
          year: 2025,
          url: 'https://example.com/paper',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: 'Nature',
          doi: '10.1234/example',
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'References Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty segments array', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Empty Segments Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(mockCreatePdf).toHaveBeenCalled();
    });

    it('handles long segment text', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const longText = 'Lorem ipsum dolor sit amet, '.repeat(100);

      const data = {
        title: 'Long Text Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [{ speaker: 'HOST' as const, text: longText }],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
    });

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

    it('handles multiple consecutive citation markers in text', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Multiple Citations Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [{ speaker: 'HOST' as const, text: 'Multiple studies [1][2][3] confirm this.' }],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('output buffer generation', () => {
    it('returns a valid Buffer instance', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
      });

      const data = {
        title: 'Buffer Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('converts Uint8Array to Buffer correctly', async () => {
      const testData = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(testData);
      });

      const data = {
        title: 'Conversion Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      const buffer = await generatePodcastPdf(data);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer[0]).toBe(0x25);
    });
  });
});
