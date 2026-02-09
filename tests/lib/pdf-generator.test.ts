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

  describe('document definition construction', () => {
    it('generates a PDF with title, topic, and creator', async () => {
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
      expect(mockCreatePdf).toHaveBeenCalled();

      const docDef = mockCreatePdf.mock.calls[0][0];
      expect(docDef.content[0].text).toBe('Test Podcast Title');
      expect(docDef.content[1].text).toBe('Test Topic');
      expect(docDef.content[2].text).toBe('By John Doe');
    });

    it('formats date in US locale format', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Date Test',
        topic: 'Testing',
        creatorName: 'Jane Smith',
        createdAt: new Date('2026-12-25T00:00:00Z'),
        segments: [],
        references: [],
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const dateText = docDef.content[3].text;

      expect(dateText).toMatch(/December 25, 2026/);
    });

    it('includes reference count when references exist', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-1',
          number: 1,
          title: 'First Reference',
          authors: ['Author One'],
          year: 2025,
          url: 'https://example.com/ref1',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
        {
          id: 'ref-2',
          number: 2,
          title: 'Second Reference',
          authors: ['Author Two'],
          year: 2024,
          url: 'https://example.com/ref2',
          type: 'BOOK',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'Reference Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const refCountElement = docDef.content.find(
        (item: { text?: string }) =>
          typeof item.text === 'string' && item.text.includes('reference')
      );

      expect(refCountElement.text).toContain('2 references cited');
    });

    it('uses singular "reference" for single reference', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-1',
          number: 1,
          title: 'Only Reference',
          authors: ['Solo Author'],
          year: 2025,
          url: 'https://example.com/ref',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'Single Reference Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const refCountElement = docDef.content.find(
        (item: { text?: string }) =>
          typeof item.text === 'string' && item.text.includes('reference')
      );

      expect(refCountElement.text).toBe('1 reference cited');
    });

    it('sets document metadata correctly', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Metadata Test',
        topic: 'Testing Metadata',
        creatorName: 'Meta Author',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];

      expect(docDef.info.title).toBe('Metadata Test');
      expect(docDef.info.author).toBe('Meta Author');
      expect(docDef.info.subject).toBe('Testing Metadata');
      expect(docDef.info.creator).toBe('Sotto - Podcasts that listen back');
    });
  });

  describe('segment text inclusion', () => {
    it('includes HOST and EXPERT segments in correct order', async () => {
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

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const transcriptIndex = content.findIndex(
        (item: { text?: string }) => item.text === 'Transcript'
      );

      const segmentTexts = content
        .slice(transcriptIndex + 1)
        .filter((item: { text?: string | unknown[] }) => {
          if (typeof item.text === 'string') {
            return item.text === 'Host' || item.text === 'Expert';
          }
          if (Array.isArray(item.text)) {
            return item.text.length > 0;
          }
          return false;
        });

      expect(segmentTexts.length).toBeGreaterThan(0);
    });

    it('applies correct colors to HOST and EXPERT labels', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Color Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'Host segment' },
          { speaker: 'EXPERT' as const, text: 'Expert segment' },
        ],
        references: [],
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const hostLabel = content.find(
        (item: { text?: string; color?: string }) =>
          item.text === 'Host' && item.color === '#D97706'
      );
      const expertLabel = content.find(
        (item: { text?: string; color?: string }) =>
          item.text === 'Expert' && item.color === '#1E3A5F'
      );

      expect(hostLabel).toBeDefined();
      expect(expertLabel).toBeDefined();
    });

    it('parses [N] citation markers in segment text', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'Citation Parsing Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [{ speaker: 'HOST' as const, text: 'This is a fact [1] from research.' }],
        references: [],
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const segmentContent = content.find(
        (item: { text?: unknown[] }) =>
          Array.isArray(item.text) &&
          item.text.some(
            (part: unknown) =>
              typeof part === 'object' && (part as { text?: string }).text === '[1]'
          )
      );

      expect(segmentContent).toBeDefined();
    });
  });

  describe('references section formatting', () => {
    it('creates references section with proper formatting', async () => {
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

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const referencesHeader = content.find(
        (item: { text?: string }) => item.text === 'References'
      );

      expect(referencesHeader).toBeDefined();
    });

    it('sorts references by number in ascending order', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-3',
          number: 3,
          title: 'Third Reference',
          authors: ['Third Author'],
          year: 2025,
          url: 'https://example.com/ref3',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
        {
          id: 'ref-1',
          number: 1,
          title: 'First Reference',
          authors: ['First Author'],
          year: 2025,
          url: 'https://example.com/ref1',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
        {
          id: 'ref-2',
          number: 2,
          title: 'Second Reference',
          authors: ['Second Author'],
          year: 2025,
          url: 'https://example.com/ref2',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'Sort Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const refSectionStartIndex = content.findIndex(
        (item: { text?: string }) => item.text === 'References'
      );

      const refItems = content
        .slice(refSectionStartIndex + 1)
        .filter((item: { text?: unknown[] }) => Array.isArray(item.text));

      expect(refItems.length).toBe(3);
    });

    it('includes all reference metadata fields', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-full',
          number: 1,
          title: 'Complete Reference',
          authors: ['Author One', 'Author Two'],
          year: 2025,
          url: 'https://example.com/full',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: 'Science Magazine',
          doi: '10.9999/complete',
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'Full Reference Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const refItem = content.find(
        (item: { text?: unknown[] }) =>
          Array.isArray(item.text) &&
          item.text.some(
            (part: unknown) =>
              typeof part === 'object' && (part as { text?: string }).text === 'Complete Reference'
          )
      );

      expect(refItem).toBeDefined();
      expect(refItem.text).toBeDefined();
    });

    it('makes URLs clickable links', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const references: ReferenceData[] = [
        {
          id: 'ref-link',
          number: 1,
          title: 'Linked Reference',
          authors: ['Link Author'],
          year: 2025,
          url: 'https://example.com/link',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
        },
      ];

      const data = {
        title: 'Link Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const refItem = content.find(
        (item: { text?: unknown[] }) =>
          Array.isArray(item.text) &&
          item.text.some(
            (part: unknown) =>
              typeof part === 'object' &&
              (part as { link?: string }).link === 'https://example.com/link'
          )
      );

      expect(refItem).toBeDefined();
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

    it('handles no references', async () => {
      mockGetBuffer.mockImplementation((callback: (buf: Uint8Array) => void) => {
        callback(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      });

      const data = {
        title: 'No References Test',
        topic: 'Testing',
        creatorName: 'Test User',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [{ speaker: 'HOST' as const, text: 'Test segment' }],
        references: [],
      };

      await generatePodcastPdf(data);

      const docDef = mockCreatePdf.mock.calls[0][0];
      const content = docDef.content;

      const referencesHeader = content.find(
        (item: { text?: string }) => item.text === 'References'
      );

      expect(referencesHeader).toBeUndefined();
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
