import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGenerateResponse = vi.fn();
vi.mock('@/lib/claude', () => ({
  generateResponse: (...args: unknown[]) => mockGenerateResponse(...args),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---- Import under test ----
import {
  verifyUrl,
  verifyDoi,
  searchTitle,
  aiEvaluateReferences,
  computeVerificationVerdict,
  type ReferenceInput,
  type VerificationCheck,
} from '@/lib/reference-validator';

// ---- Helpers ----

function makeRef(overrides: Partial<ReferenceInput> = {}): ReferenceInput {
  return {
    id: 'ref-001',
    number: 1,
    title: 'Attention Is All You Need',
    authors: ['Vaswani, A.', 'Shazeer, N.'],
    year: 2017,
    url: 'https://arxiv.org/abs/1706.03762',
    doi: '10.48550/arXiv.1706.03762',
    type: 'PAPER',
    ...overrides,
  };
}

// ---- Tests ----

describe('verifyUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passed when URL returns 200', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const result = await verifyUrl(makeRef());
    expect(result.layer).toBe('url');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.6);
  });

  it('returns passed for redirect (301)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 301 });
    const result = await verifyUrl(makeRef());
    expect(result.passed).toBe(true);
  });

  it('returns failed for 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await verifyUrl(makeRef());
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('returns failed when no URL provided', async () => {
    const result = await verifyUrl(makeRef({ url: null }));
    expect(result.passed).toBe(false);
    expect(result.detail).toBe('No URL provided');
  });

  it('returns failed when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await verifyUrl(makeRef());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Network error');
  });
});

describe('verifyDoi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passed when DOI matches with high title similarity', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: {
          title: ['Attention Is All You Need'],
          author: [{ given: 'Ashish', family: 'Vaswani' }],
          published: { 'date-parts': [[2017]] },
          publisher: 'arXiv',
        },
      }),
    });

    const result = await verifyDoi(makeRef());
    expect(result.layer).toBe('doi');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.95);
  });

  it('returns failed when DOI exists but title does not match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: {
          title: ['Completely Different Paper Title'],
          author: [],
          published: { 'date-parts': [[2020]] },
        },
      }),
    });

    const result = await verifyDoi(makeRef());
    expect(result.passed).toBe(false);
  });

  it('returns failed when no DOI provided', async () => {
    const result = await verifyDoi(makeRef({ doi: null }));
    expect(result.passed).toBe(false);
    expect(result.detail).toBe('No DOI provided');
  });

  it('returns failed when CrossRef returns 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await verifyDoi(makeRef());
    expect(result.passed).toBe(false);
  });

  it('strips https://doi.org/ prefix from DOI', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: {
          title: ['Attention Is All You Need'],
          author: [],
          published: { 'date-parts': [[2017]] },
        },
      }),
    });

    await verifyDoi(makeRef({ doi: 'https://doi.org/10.48550/arXiv.1706.03762' }));

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('10.48550'),
      expect.anything()
    );
  });

  it('returns failed when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Timeout'));
    const result = await verifyDoi(makeRef());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Timeout');
  });
});

describe('searchTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passed when title matches in OpenAlex', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          {
            title: 'Attention Is All You Need',
            authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
            publication_year: 2017,
            doi: 'https://doi.org/10.48550/arXiv.1706.03762',
            primary_location: {
              landing_page_url: 'https://arxiv.org/abs/1706.03762',
              source: { display_name: 'arXiv' },
            },
          },
        ],
      }),
    });

    const result = await searchTitle(makeRef());
    expect(result.layer).toBe('title_search');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  it('returns failed when no results found', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });

    const result = await searchTitle(makeRef());
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('No results');
  });

  it('returns failed when title too short', async () => {
    const result = await searchTitle(makeRef({ title: 'Hi' }));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('too short');
  });

  it('returns failed when OpenAlex returns error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await searchTitle(makeRef());
    expect(result.passed).toBe(false);
  });

  it('returns failed when best match similarity is below threshold', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          {
            title: 'Completely Unrelated Title About Something Else',
            authorships: [],
            publication_year: 2020,
          },
        ],
      }),
    });

    const result = await searchTitle(makeRef());
    expect(result.passed).toBe(false);
  });
});

describe('aiEvaluateReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns REAL verdict for verified references', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        evaluations: [
          {
            refNumber: 1,
            verdict: 'REAL',
            confidence: 0.95,
            reasoning: 'Well-known paper',
            suggestedReplacement: null,
          },
        ],
      }),
      inputTokens: 100,
      outputTokens: 50,
    });

    const refs = [makeRef()];
    const priorChecks = new Map<string, VerificationCheck[]>();
    priorChecks.set('ref-001', [
      { layer: 'url', passed: true, confidence: 0.6, detail: 'OK' },
    ]);

    const results = await aiEvaluateReferences(refs, priorChecks, 'machine learning');

    const check = results.get('ref-001');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
    expect(check!.layer).toBe('ai');
  });

  it('returns HALLUCINATED verdict for suspicious references', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        evaluations: [
          {
            refNumber: 1,
            verdict: 'HALLUCINATED',
            confidence: 0.9,
            reasoning: 'This paper does not exist',
            suggestedReplacement: {
              title: 'Real Paper Title',
              authors: ['Real Author'],
              year: 2020,
              url: 'https://example.com',
              doi: null,
            },
          },
        ],
      }),
      inputTokens: 100,
      outputTokens: 50,
    });

    const refs = [makeRef()];
    const priorChecks = new Map<string, VerificationCheck[]>();

    const results = await aiEvaluateReferences(refs, priorChecks, 'test topic');

    const check = results.get('ref-001');
    expect(check!.passed).toBe(false);
    expect(check!.replacement).toBeDefined();
    expect(check!.replacement!.title).toBe('Real Paper Title');
  });

  it('handles AI failure gracefully', async () => {
    mockGenerateResponse.mockRejectedValue(new Error('API unavailable'));

    const refs = [makeRef()];
    const priorChecks = new Map<string, VerificationCheck[]>();

    const results = await aiEvaluateReferences(refs, priorChecks, 'test');

    const check = results.get('ref-001');
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.detail).toContain('failed');
  });

  it('handles non-JSON AI response', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: 'I cannot evaluate these references.',
      inputTokens: 100,
      outputTokens: 50,
    });

    const refs = [makeRef()];
    const priorChecks = new Map<string, VerificationCheck[]>();

    const results = await aiEvaluateReferences(refs, priorChecks, 'test');

    const check = results.get('ref-001');
    expect(check!.passed).toBe(false);
    expect(check!.detail).toContain('unparseable');
  });
});

describe('computeVerificationVerdict', () => {
  it('returns VERIFIED when DOI passes with high confidence', () => {
    const checks: VerificationCheck[] = [
      { layer: 'doi', passed: true, confidence: 0.95, detail: 'DOI verified' },
      { layer: 'url', passed: true, confidence: 0.6, detail: 'URL OK' },
    ];

    const verdict = computeVerificationVerdict(checks);
    expect(verdict.status).toBe('VERIFIED');
    expect(verdict.confidence).toBe(0.95);
  });

  it('returns REMOVED when URL fails + title not found + AI says hallucinated', () => {
    const checks: VerificationCheck[] = [
      { layer: 'url', passed: false, confidence: 0, detail: 'URL returned 404' },
      { layer: 'title_search', passed: false, confidence: 0, detail: 'Not found' },
      { layer: 'ai', passed: false, confidence: 0, detail: 'AI: HALLUCINATED — does not exist' },
    ];

    const verdict = computeVerificationVerdict(checks);
    expect(verdict.status).toBe('REMOVED');
  });

  it('returns REPLACED when override rule triggers but replacement available', () => {
    const checks: VerificationCheck[] = [
      { layer: 'url', passed: false, confidence: 0, detail: 'URL returned 404' },
      { layer: 'title_search', passed: false, confidence: 0, detail: 'Not found' },
      {
        layer: 'ai',
        passed: false,
        confidence: 0,
        detail: 'AI: HALLUCINATED — fake',
        replacement: {
          title: 'Real Paper',
          authors: ['Author A'],
          year: 2020,
          url: 'https://example.com',
          doi: null,
          publisher: null,
        },
      },
    ];

    const verdict = computeVerificationVerdict(checks);
    expect(verdict.status).toBe('REPLACED');
    expect(verdict.replacement).toBeDefined();
    expect(verdict.replacement!.title).toBe('Real Paper');
  });

  it('returns VERIFIED when weighted average is above threshold', () => {
    const checks: VerificationCheck[] = [
      { layer: 'url', passed: true, confidence: 0.6, detail: 'URL OK' },
      { layer: 'title_search', passed: true, confidence: 0.9, detail: 'Found' },
      { layer: 'ai', passed: true, confidence: 0.8, detail: 'AI: REAL' },
    ];

    const verdict = computeVerificationVerdict(checks);
    expect(verdict.status).toBe('VERIFIED');
    expect(verdict.confidence).toBeGreaterThan(0.5);
  });

  it('returns REMOVED when score is below threshold with no replacement', () => {
    const checks: VerificationCheck[] = [
      { layer: 'url', passed: false, confidence: 0, detail: 'Failed' },
      { layer: 'doi', passed: false, confidence: 0, detail: 'No DOI' },
      { layer: 'title_search', passed: false, confidence: 0.1, detail: 'Low match' },
      { layer: 'ai', passed: false, confidence: 0, detail: 'AI: SUSPICIOUS' },
    ];

    const verdict = computeVerificationVerdict(checks);
    expect(verdict.status).toBe('REMOVED');
  });

  it('returns REPLACED when score is below threshold but replacement available', () => {
    const checks: VerificationCheck[] = [
      { layer: 'url', passed: false, confidence: 0, detail: 'Failed' },
      {
        layer: 'title_search',
        passed: false,
        confidence: 0.2,
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
      { layer: 'ai', passed: false, confidence: 0, detail: 'AI: SUSPICIOUS' },
    ];

    const verdict = computeVerificationVerdict(checks);
    expect(verdict.status).toBe('REPLACED');
    expect(verdict.replacement!.title).toBe('Better Paper');
  });
});
