import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockFetch = vi.fn();

global.fetch = mockFetch;

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/url-validator', () => ({
  validateUrl: vi.fn().mockResolvedValue(undefined),
  safeFetch: vi.fn(async (url: string, init?: RequestInit) => {
    return globalThis.fetch(url, init);
  }),
  UrlValidationError: class UrlValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UrlValidationError';
    }
  },
}));

// ---- Import under test ----
import {
  verifyUrl,
  verifyDoi,
  searchTitle,
  computeVerificationVerdict,
} from '@/lib/reference-validator';
import type { ReferenceInput, VerificationCheck } from '@/lib/reference-validator';

// ---- Helper ----
const createMockReference = (overrides: Partial<ReferenceInput> = {}): ReferenceInput => ({
  id: 'ref-1',
  number: 1,
  title: 'Test Paper Title',
  authors: ['Smith, J.', 'Doe, A.'],
  year: 2023,
  url: 'https://example.com/paper',
  doi: '10.1234/test',
  type: 'PAPER',
  ...overrides,
});

// ---- Tests ----

describe('reference-validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyUrl', () => {
    it('returns passed=true for 200 OK status', async () => {
      const ref = createMockReference();
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await verifyUrl(ref);

      expect(result.layer).toBe('url');
      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(0.6);
      expect(result.detail).toContain('200');
    });

    it('returns passed=true for redirect status codes', async () => {
      const ref = createMockReference();
      mockFetch.mockResolvedValue({ ok: false, status: 301 });

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(0.6);
      expect(result.detail).toContain('301');
    });

    it('returns passed=false for 404 status', async () => {
      const ref = createMockReference();
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toContain('404');
    });

    it('returns passed=false for 500 server error', async () => {
      const ref = createMockReference();
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toContain('500');
    });

    it('scores bot-block statuses (403/405/429) as neutral evidence', async () => {
      for (const status of [403, 405, 429]) {
        const ref = createMockReference();
        mockFetch.mockResolvedValue({ ok: false, status });

        const result = await verifyUrl(ref);

        expect(result.passed).toBe(false);
        expect(result.confidence).toBe(0.5);
        expect(result.detail).toContain('bot-blocked');
      }
    });

    it('returns passed=false when no URL provided', async () => {
      const ref = createMockReference({ url: null });

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toBe('No URL provided');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns passed=false when URL is empty string', async () => {
      const ref = createMockReference({ url: '' });

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(false);
      expect(result.detail).toBe('No URL provided');
    });

    it('handles timeout with abort signal', async () => {
      const ref = createMockReference();
      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('aborted')), 10);
        });
      });

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(false);
      expect(result.detail).toContain('URL check failed');
    });

    it('scores network errors as neutral evidence', async () => {
      const ref = createMockReference();
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await verifyUrl(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0.5);
      expect(result.detail).toContain('Network error');
    });

    it('uses HEAD method and proper headers', async () => {
      const ref = createMockReference({ url: 'https://test.com/article' });
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await verifyUrl(ref);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.com/article',
        expect.objectContaining({
          method: 'HEAD',
          headers: { 'User-Agent': 'Sotto/1.0 (reference-validator)' },
        })
      );
    });
  });

  describe('verifyDoi', () => {
    it('returns passed=true when DOI exists and title matches', async () => {
      const ref = createMockReference({
        title: 'Climate Change Analysis',
        doi: '10.1234/climate',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['Climate Change Analysis'],
            author: [
              { given: 'John', family: 'Smith' },
              { given: 'Alice', family: 'Doe' },
            ],
            published: { 'date-parts': [[2023]] },
            publisher: 'Nature',
          },
        }),
      });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.detail).toContain('DOI verified');
      expect(result.replacement).toBeDefined();
      expect(result.replacement?.title).toBe('Climate Change Analysis');
      expect(result.replacement?.authors).toEqual(['John Smith', 'Alice Doe']);
      expect(result.replacement?.year).toBe(2023);
    });

    it('strips https://doi.org/ prefix from DOI', async () => {
      const ref = createMockReference({
        doi: 'https://doi.org/10.1234/test',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['Test Paper Title'],
            author: [],
            published: { 'date-parts': [[2022]] },
          },
        }),
      });

      await verifyDoi(ref);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.crossref.org/works/10.1234%2Ftest',
        expect.any(Object)
      );
    });

    it('returns passed=false when neither CrossRef nor DataCite know the DOI', async () => {
      const ref = createMockReference({ doi: '10.9999/notfound' });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toContain('CrossRef 404');
      expect(result.detail).toContain('DataCite 404');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('verifies a DataCite-registered DOI CrossRef does not know', async () => {
      const ref = createMockReference({
        title: 'Propädeutische Grammatik',
        doi: '10.14618/programm',
      });

      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              titles: [{ title: 'Propädeutische Grammatik' }],
              creators: [{ name: 'Leibniz-Institut für Deutsche Sprache' }],
              publicationYear: 2019,
              publisher: 'IDS Mannheim',
            },
          },
        }),
      });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(0.9);
      expect(result.detail).toContain('DataCite');
      expect(result.replacement?.title).toBe('Propädeutische Grammatik');
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.datacite.org/dois/10.14618%2Fprogramm',
        expect.any(Object)
      );
    });

    it('fails a DataCite DOI whose title does not match', async () => {
      const ref = createMockReference({
        title: 'Completely Different Subject',
        doi: '10.14618/other',
      });

      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            attributes: {
              titles: [{ title: 'Propädeutische Grammatik' }],
              creators: [],
              publicationYear: 2019,
            },
          },
        }),
      });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(false);
      expect(result.detail).toContain('title mismatch');
    });

    it('returns passed=false when no DOI provided', async () => {
      const ref = createMockReference({ doi: null });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toBe('No DOI provided');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns passed=false when title similarity is low', async () => {
      const ref = createMockReference({
        title: 'Quantum Computing',
        doi: '10.1234/different',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['Climate Change Studies'],
            author: [],
            published: { 'date-parts': [[2023]] },
            publisher: 'Elsevier',
          },
        }),
      });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(false);
      expect(result.detail).toContain('title mismatch');
      expect(result.replacement).toBeDefined();
      expect(result.replacement?.title).toBe('Climate Change Studies');
    });

    it('scores registrar timeouts as neutral evidence', async () => {
      const ref = createMockReference({ doi: '10.1234/timeout' });

      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('aborted')), 10);
        });
      });

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0.5);
      expect(result.detail).toContain('DOI check failed');
    });

    it('uses CrossRef API with proper headers', async () => {
      const ref = createMockReference({ doi: '10.1234/test' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { title: ['Test'], author: [] },
        }),
      });

      await verifyDoi(ref);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.crossref.org/works/10.1234%2Ftest',
        expect.objectContaining({
          headers: { 'User-Agent': 'Sotto/1.0 (reference-validator)' },
        })
      );
    });

    it('handles missing author information', async () => {
      const ref = createMockReference({ doi: '10.1234/noauthor' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            title: ['Test Paper Title'],
            author: [],
            published: { 'date-parts': [[2023]] },
          },
        }),
      });

      const result = await verifyDoi(ref);

      expect(result.replacement?.authors).toEqual([]);
    });

    it('handles network errors gracefully', async () => {
      const ref = createMockReference({ doi: '10.1234/error' });

      mockFetch.mockRejectedValue(new Error('DNS failure'));

      const result = await verifyDoi(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0.5);
      expect(result.detail).toContain('DNS failure');
    });
  });

  describe('searchTitle', () => {
    it('returns passed=true when title found in OpenAlex', async () => {
      const ref = createMockReference({
        title: 'Machine Learning Fundamentals',
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Machine Learning Fundamentals',
              authorships: [
                { author: { display_name: 'Jane Doe' } },
                { author: { display_name: 'Bob Smith' } },
              ],
              publication_year: 2022,
              doi: 'https://doi.org/10.5678/ml',
              primary_location: {
                landing_page_url: 'https://example.com/ml',
                source: { display_name: 'Journal of AI' },
              },
            },
          ],
        }),
      });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(true);
      expect(result.confidence).toBe(0.9);
      expect(result.detail).toContain('Title matched in OpenAlex');
      expect(result.replacement).toBeDefined();
      expect(result.replacement?.authors).toEqual(['Jane Doe', 'Bob Smith']);
      expect(result.replacement?.year).toBe(2022);
    });

    it('returns passed=false when title too short', async () => {
      const ref = createMockReference({ title: 'AI' });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(false);
      expect(result.detail).toBe('Title too short to search');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns passed=false when no results found', async () => {
      const ref = createMockReference({ title: 'Nonexistent Paper Title 9999' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.detail).toBe('No results found in OpenAlex');
    });

    it('checks top 3 results for a match', async () => {
      const ref = createMockReference({ title: 'Target Paper' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { title: 'Unrelated Paper 1', authorships: [] },
            { title: 'Unrelated Paper 2', authorships: [] },
            {
              title: 'Target Paper',
              authorships: [{ author: { display_name: 'Author One' } }],
              publication_year: 2021,
            },
          ],
        }),
      });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(true);
      expect(result.replacement?.title).toBe('Target Paper');
    });

    it('returns low confidence when no match found', async () => {
      const ref = createMockReference({ title: 'Quantum Computing Basics' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [{ title: 'Classical Algorithm Theory', authorships: [] }],
        }),
      });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0); // No word overlap after normalization
      expect(result.detail).toContain('below threshold');
    });

    it('handles OpenAlex API errors', async () => {
      const ref = createMockReference({ title: 'Test Paper' });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(false);
      expect(result.confidence).toBe(0.5);
      expect(result.detail).toContain('503');
    });

    it('handles network timeout', async () => {
      const ref = createMockReference({ title: 'Timeout Paper' });

      mockFetch.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), 10);
        });
      });

      const result = await searchTitle(ref);

      expect(result.passed).toBe(false);
      expect(result.detail).toContain('OpenAlex check failed');
    });

    it('includes mailto parameter when OPENALEX_EMAIL is set', async () => {
      const originalEnv = process.env.OPENALEX_EMAIL;
      process.env.OPENALEX_EMAIL = 'test@example.com';

      const ref = createMockReference({ title: 'Email Test Paper' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchTitle(ref);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mailto=test%40example.com'),
        expect.any(Object)
      );

      process.env.OPENALEX_EMAIL = originalEnv;
    });

    it('falls back to DOI URL when no landing page URL available', async () => {
      const ref = createMockReference({ title: 'Paper Without URL' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              title: 'Paper Without URL',
              authorships: [],
              publication_year: 2023,
              doi: 'https://doi.org/10.1234/nourl',
              primary_location: {},
            },
          ],
        }),
      });

      const result = await searchTitle(ref);

      expect(result.replacement?.url).toBe('https://doi.org/10.1234/nourl');
    });
  });

  describe('computeVerificationVerdict', () => {
    it('returns VERIFIED for high DOI confidence', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'doi', passed: true, confidence: 0.95, detail: 'DOI verified' },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('VERIFIED');
      expect(verdict.confidence).toBe(0.95);
    });

    it('returns REMOVED for hallucinated reference with no replacement', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'url', passed: false, confidence: 0, detail: 'URL 404' },
        { layer: 'title_search', passed: false, confidence: 0, detail: 'Not found' },
        { layer: 'ai', passed: false, confidence: 0, detail: 'AI: HALLUCINATED — Not real' },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('REMOVED');
      expect(verdict.confidence).toBe(0);
    });

    it('returns REPLACED for failed reference with suggested replacement', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'url', passed: false, confidence: 0, detail: 'URL 404' },
        { layer: 'title_search', passed: false, confidence: 0, detail: 'Not found' },
        {
          layer: 'ai',
          passed: false,
          confidence: 0,
          detail: 'AI: HALLUCINATED — Fake',
          replacement: {
            title: 'Real Paper',
            authors: ['Real Author'],
            year: 2022,
            url: 'https://real.com',
            doi: null,
            publisher: null,
          },
        },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('REPLACED');
      expect(verdict.replacement).toBeDefined();
      expect(verdict.replacement?.title).toBe('Real Paper');
    });

    it('computes weighted average for mixed results', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'url', passed: true, confidence: 0.6, detail: 'URL OK' },
        { layer: 'title_search', passed: false, confidence: 0.2, detail: 'Partial match' },
        { layer: 'ai', passed: false, confidence: 0.3, detail: 'Suspicious' },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.confidence).toBeCloseTo(0.3, 1);
      expect(verdict.status).toBe('REMOVED');
    });

    it('returns VERIFIED when composite score >= 0.5', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'url', passed: true, confidence: 0.6, detail: 'URL OK' },
        { layer: 'title_search', passed: true, confidence: 0.9, detail: 'Found' },
        { layer: 'ai', passed: true, confidence: 0.8, detail: 'Real' },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('VERIFIED');
      expect(verdict.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it('prefers DOI replacement over other layers', async () => {
      const checks: VerificationCheck[] = [
        {
          layer: 'doi',
          passed: false,
          confidence: 0.1,
          detail: 'Title mismatch',
          replacement: {
            title: 'DOI Title',
            authors: ['DOI Author'],
            year: 2021,
            url: 'https://doi.com/test',
            doi: '10.1234/test',
            publisher: 'DOI Publisher',
          },
        },
        {
          layer: 'title_search',
          passed: false,
          confidence: 0.2,
          detail: 'Below threshold',
          replacement: {
            title: 'Title Search Result',
            authors: ['Search Author'],
            year: 2022,
            url: 'https://search.com',
            doi: null,
            publisher: null,
          },
        },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.replacement?.title).toBe('DOI Title');
      expect(verdict.replacement?.doi).toBe('10.1234/test');
    });

    it('handles empty checks array', async () => {
      const checks: VerificationCheck[] = [];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('REMOVED');
      expect(verdict.confidence).toBe(0);
    });

    it('returns REPLACED when score below threshold with replacement', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'url', passed: false, confidence: 0.1, detail: 'Failed' },
        {
          layer: 'title_search',
          passed: false,
          confidence: 0.3,
          detail: 'Partial match',
          replacement: {
            title: 'Better Paper',
            authors: ['Author B'],
            year: 2021,
            url: 'https://example.com/better',
            doi: '10.1234/better',
            publisher: 'Publisher X',
          },
        },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('REPLACED');
      expect(verdict.replacement?.title).toBe('Better Paper');
    });

    it('overrides with VERIFIED for DOI with 0.9+ confidence even with failed other checks', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'doi', passed: true, confidence: 0.95, detail: 'DOI verified' },
        { layer: 'url', passed: false, confidence: 0, detail: 'URL 404' },
        { layer: 'ai', passed: false, confidence: 0, detail: 'Suspicious' },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.status).toBe('VERIFIED');
      expect(verdict.confidence).toBe(0.95);
    });

    it('uses title_search replacement as fallback when DOI has no replacement', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'doi', passed: false, confidence: 0, detail: 'Not found' },
        {
          layer: 'title_search',
          passed: false,
          confidence: 0.2,
          detail: 'Partial match',
          replacement: {
            title: 'Title Match',
            authors: ['Author T'],
            year: 2020,
            url: 'https://title.com',
            doi: null,
            publisher: null,
          },
        },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.replacement?.title).toBe('Title Match');
    });

    it('uses AI replacement as last resort', async () => {
      const checks: VerificationCheck[] = [
        { layer: 'url', passed: false, confidence: 0, detail: 'Failed' },
        {
          layer: 'ai',
          passed: false,
          confidence: 0,
          detail: 'HALLUCINATED',
          replacement: {
            title: 'AI Suggested',
            authors: ['AI Author'],
            year: 2023,
            url: 'https://ai.com',
            doi: null,
            publisher: null,
          },
        },
      ];

      const verdict = computeVerificationVerdict(checks);

      expect(verdict.replacement?.title).toBe('AI Suggested');
    });
  });
});
