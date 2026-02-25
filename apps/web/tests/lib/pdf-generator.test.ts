import { describe, it, expect } from 'vitest';
import type { ReferenceData } from '@/types/reference';
import { generatePodcastTranscript } from '@/lib/pdf-generator';

describe('pdf-generator', () => {
  describe('basic transcript generation', () => {
    it('generates a markdown string with title and metadata', () => {
      const data = {
        title: 'Test Podcast Title',
        topic: 'Test Topic',
        creatorName: 'John Doe',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references: [],
      };

      const result = generatePodcastTranscript(data);

      expect(typeof result).toBe('string');
      expect(result).toContain('# Test Podcast Title');
      expect(result).toContain('Test Topic');
      expect(result).toContain('By John Doe');
    });

    it('formats segments with timestamps and speaker labels', () => {
      const data = {
        title: 'Test',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'Welcome to the show.', startTime: 0 },
          { speaker: 'EXPERT' as const, text: 'Thanks for having me.', startTime: 135 },
        ],
        references: [],
      };

      const result = generatePodcastTranscript(data);

      expect(result).toContain('[00:00] **HOST**');
      expect(result).toContain('Welcome to the show.');
      expect(result).toContain('[02:15] **EXPERT**');
      expect(result).toContain('Thanks for having me.');
    });

    it('uses [--:--] for null startTime', () => {
      const data = {
        title: 'Test',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'Hello.', startTime: null },
        ],
        references: [],
      };

      const result = generatePodcastTranscript(data);

      expect(result).toContain('[--:--] **HOST**');
    });

    it('formats timestamps with leading zeros', () => {
      const data = {
        title: 'Test',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'Intro.', startTime: 5 },
          { speaker: 'EXPERT' as const, text: 'Late segment.', startTime: 642 },
        ],
        references: [],
      };

      const result = generatePodcastTranscript(data);

      expect(result).toContain('[00:05] **HOST**');
      expect(result).toContain('[10:42] **EXPERT**');
    });
  });

  describe('references', () => {
    it('includes a references section when references are provided', () => {
      const references: ReferenceData[] = [
        {
          id: 'ref-1',
          number: 1,
          title: 'Introduction to Quantum Computing',
          authors: ['John Smith', 'Jane Doe'],
          year: 2023,
          url: 'https://example.com/quantum-intro',
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: 'Nature',
          doi: '10.1038/nature12345',
          verificationDetails: null,
          contentDomain: null,
        },
      ];

      const data = {
        title: 'Test',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      const result = generatePodcastTranscript(data);

      expect(result).toContain('## References');
      expect(result).toContain('[1] *Introduction to Quantum Computing*');
      expect(result).toContain('John Smith, Jane Doe');
      expect(result).toContain('(2023)');
      expect(result).toContain('Nature');
      expect(result).toContain('DOI: 10.1038/nature12345');
      expect(result).toContain('https://example.com/quantum-intro');
    });

    it('handles references without optional fields', () => {
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
          contentDomain: null,
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

      const result = generatePodcastTranscript(data);

      expect(result).toContain('[1] *Minimal Reference*');
      expect(result).not.toContain('DOI:');
    });

    it('sorts references by number', () => {
      const references: ReferenceData[] = [
        {
          id: 'ref-3',
          number: 3,
          title: 'Third Reference',
          authors: [],
          year: null,
          url: null,
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
          contentDomain: null,
        },
        {
          id: 'ref-1',
          number: 1,
          title: 'First Reference',
          authors: [],
          year: null,
          url: null,
          type: 'ARTICLE',
          verificationStatus: 'VERIFIED',
          publisher: null,
          doi: null,
          verificationDetails: null,
          contentDomain: null,
        },
      ];

      const data = {
        title: 'Test',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [],
        references,
      };

      const result = generatePodcastTranscript(data);
      const firstIdx = result.indexOf('[1] *First Reference*');
      const thirdIdx = result.indexOf('[3] *Third Reference*');

      expect(firstIdx).toBeLessThan(thirdIdx);
    });

    it('omits references section when there are no references', () => {
      const data = {
        title: 'No Refs',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'No citations here.', startTime: 0 },
        ],
        references: [],
      };

      const result = generatePodcastTranscript(data);

      expect(result).not.toContain('## References');
    });
  });

  describe('citation markers', () => {
    it('preserves [N] citation markers in segment text', () => {
      const data = {
        title: 'Test',
        topic: 'Topic',
        creatorName: 'Creator',
        createdAt: new Date('2026-02-09T10:00:00Z'),
        segments: [
          { speaker: 'HOST' as const, text: 'This is cited [1] and this too [2, 3].', startTime: 0 },
        ],
        references: [],
      };

      const result = generatePodcastTranscript(data);

      expect(result).toContain('[1]');
      expect(result).toContain('[2, 3]');
    });
  });
});
