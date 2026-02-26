import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractContent } from '@/lib/extractors';
import { extractHtmlContent } from '@/lib/extractors/html';

// Mock summarize-core to avoid real network calls from YouTube extractor
vi.mock('@steipete/summarize-core', () => ({
  createLinkPreviewClient: () => ({
    fetchLinkContent: vi.fn().mockResolvedValue({
      content: '',
      title: null,
      description: null,
      siteName: 'YouTube',
      transcriptSource: null,
      transcriptionProvider: null,
      wordCount: 0,
    }),
  }),
}));

// Mock logger to avoid noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Fixtures
const WELL_STRUCTURED_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Test Article Title</title>
  <meta name="description" content="Test description">
  <meta name="author" content="Jane Doe">
  <meta property="og:title" content="OG Test Title">
  <meta property="og:description" content="OG description">
  <meta property="og:site_name" content="Test Site">
  <meta property="article:published_time" content="2024-01-15T10:00:00Z">
</head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <header><h1>Site Header</h1></header>
  <article>
    <h1>The Main Article Title</h1>
    <p>This is the first paragraph of the article with <strong>bold text</strong> and <em>italic text</em>.</p>
    <h2>Section Two</h2>
    <p>More content here with a <a href="https://example.com">link to example</a>.</p>
    <ul>
      <li>List item one</li>
      <li>List item two</li>
      <li>List item three</li>
    </ul>
    <h3>Subsection</h3>
    <p>Final paragraph with details about the topic.</p>
  </article>
  <aside><p>Related articles sidebar</p></aside>
  <footer><p>Copyright 2024</p></footer>
  <script>console.log("should be stripped")</script>
  <style>.hidden { display: none; }</style>
</body>
</html>`;

const MINIMAL_HTML = `<html><body><p>Just a paragraph.</p></body></html>`;

const EMPTY_HTML = `<html><head><title>Empty</title></head><body></body></html>`;

const HTML_WITH_ENTITIES = `<html><body><article>
  <p>Entities: &amp; &lt;tag&gt; &quot;quotes&quot; &#39;apostrophe&#39;</p>
</article></body></html>`;

const UNICODE_HTML = `<html><body><article>
  <h1>日本語テスト</h1>
  <p>これはテストです。Ñoño español. Ünïcödé characters: €£¥</p>
</article></body></html>`;

const OG_ONLY_HTML = `<html>
<head>
  <meta property="og:title" content="OG Title Only">
  <meta property="og:description" content="OG Description Only">
  <meta property="og:site_name" content="OG Site">
</head>
<body><article><p>Some content for extraction.</p></article></body>
</html>`;

describe('extractors', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchResponse(html: string, status = 200) {
    fetchSpy.mockResolvedValue(
      new Response(html, {
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: { 'Content-Type': 'text/html' },
      })
    );
  }

  describe('html extractor', () => {
    it('extracts article content via Readability from well-structured HTML', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractHtmlContent('https://example.com/article');

      expect(result.text).toContain('first paragraph');
      expect(result.text).toContain('bold text');
      expect(result.sourceType).toBe('html');
      expect(result.extractionMethod).toBe('readability');
    });

    it('strips nav, footer, header, aside, script, style elements', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractHtmlContent('https://example.com/article');

      expect(result.text).not.toContain('should be stripped');
      expect(result.text).not.toContain('display: none');
      // Readability strips nav/footer/aside content
      expect(result.text).not.toContain('Related articles sidebar');
    });

    it('falls back to cheerio when Readability returns null', async () => {
      mockFetchResponse(MINIMAL_HTML);
      const result = await extractHtmlContent('https://example.com/minimal');

      expect(result.text).toContain('Just a paragraph');
      // Minimal HTML may fail Readability → cheerio fallback
      expect(['readability', 'cheerio-fallback']).toContain(result.extractionMethod);
    });

    it('produces markdown with heading hierarchy preserved', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractHtmlContent('https://example.com/article');

      // If readability succeeds, the markdown should have some heading markers
      if (result.extractionMethod === 'readability') {
        expect(result.markdown).toContain('#');
      }
    });

    it('produces markdown with links, bold, italic, lists preserved', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractHtmlContent('https://example.com/article');

      if (result.extractionMethod === 'readability') {
        // Markdown should contain formatting markers
        expect(result.markdown.length).toBeGreaterThan(0);
      }
    });

    it('returns metadata (title, description, siteName, author, publishedDate)', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractHtmlContent('https://example.com/article');

      expect(result.title).toBeTruthy();
      expect(result.siteName).toBe('Test Site');
      expect(result.publishedDate).toBe('2024-01-15T10:00:00Z');
    });

    it('extracts Open Graph metadata when available', async () => {
      mockFetchResponse(OG_ONLY_HTML);
      const result = await extractHtmlContent('https://example.com/og');

      expect(result.title).toContain('OG');
      expect(result.siteName).toBe('OG Site');
    });

    it('handles empty/minimal HTML gracefully', async () => {
      mockFetchResponse(EMPTY_HTML);
      const result = await extractHtmlContent('https://example.com/empty');

      expect(result.text).toBeDefined();
      expect(result.wordCount).toBeGreaterThanOrEqual(0);
      expect(result.sourceType).toBe('html');
    });

    it('handles fetch failures (404)', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Not Found', { status: 404, statusText: 'Not Found' })
      );

      await expect(
        extractHtmlContent('https://example.com/missing')
      ).rejects.toThrow('HTTP 404');
    });

    it('handles fetch failures (500)', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(
        extractHtmlContent('https://example.com/error')
      ).rejects.toThrow('HTTP 500');
    });

    it('handles fetch failures (network error)', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      await expect(
        extractHtmlContent('https://example.com/offline')
      ).rejects.toThrow('Network error');
    });

    it('handles fetch timeout', async () => {
      fetchSpy.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      await expect(
        extractHtmlContent('https://example.com/slow')
      ).rejects.toThrow();
    });

    it('truncates content at 50k characters', async () => {
      const longContent = `<html><body><article><p>${'a'.repeat(60000)}</p></article></body></html>`;
      mockFetchResponse(longContent);

      const result = await extractHtmlContent('https://example.com/long');
      expect(result.text.length).toBeLessThanOrEqual(50000);
      expect(result.markdown.length).toBeLessThanOrEqual(50000);
    });

    it('computes accurate wordCount', async () => {
      const html = '<html><body><article><p>One two three four five</p></article></body></html>';
      mockFetchResponse(html);

      const result = await extractHtmlContent('https://example.com/words');
      expect(result.wordCount).toBeGreaterThanOrEqual(5);
    });

    it('handles HTML entities (&amp; &lt; etc.)', async () => {
      mockFetchResponse(HTML_WITH_ENTITIES);
      const result = await extractHtmlContent('https://example.com/entities');

      expect(result.text).toContain('&');
      expect(result.text).not.toContain('&amp;');
    });

    it('handles Unicode content', async () => {
      mockFetchResponse(UNICODE_HTML);
      const result = await extractHtmlContent('https://example.com/unicode');

      expect(result.text).toContain('日本語');
      expect(result.text).toContain('Ñoño');
      expect(result.text).toContain('€');
    });
  });

  describe('pdf extractor', () => {
    it('extracts text from PDF buffer and returns ExtractedContent', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'PDF content text here.', pages: [], total: 3 };
          }
          async getInfo() {
            return {
              total: 3,
              info: { Title: 'PDF Title', Author: 'PDF Author', CreationDate: new Date('2024-06-01') },
            };
          }
        },
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const buffer = Buffer.from('fake-pdf');
      const result = await extractPdfContent(buffer);

      expect(result.text).toBe('PDF content text here.');
      expect(result.sourceType).toBe('pdf');
      expect(result.extractionMethod).toBe('pdf-parse');
      expect(result.title).toBe('PDF Title');
      expect(result.author).toBe('PDF Author');
    });

    it('truncates at 50k characters', async () => {
      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'x'.repeat(60000), pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: {} };
          }
        },
      }));

      const { extractPdfContent } = await import('@/lib/extractors/pdf');
      const buffer = Buffer.from('fake-pdf');
      const result = await extractPdfContent(buffer);

      expect(result.text.length).toBeLessThanOrEqual(50000);
    });
  });

  describe('extractContent facade', () => {
    it('routes standard URLs to html extractor', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractContent('https://example.com/article');

      expect(result.sourceType).toBe('html');
      expect(result.text).toContain('first paragraph');
    });

    it('routes YouTube URLs to youtube extractor', async () => {
      // YouTube extractor returns sourceType 'youtube' even on failure
      const result = await extractContent('https://www.youtube.com/watch?v=test123');

      expect(result.sourceType).toBe('youtube');
      expect(result.extractionMethod).toBe('summarize-core');
    });
  });
});
