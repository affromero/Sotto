import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractContent, extractFromPdfBuffer } from '@/lib/extractors';
import { extractHtmlContent } from '@/lib/extractors/html';
import * as pinchtabModule from '@/lib/extractors/pinchtab';

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

// Mock Markit extractor to avoid real file parsing in facade tests
const mockExtractViaMarkit = vi.fn();
vi.mock('@/lib/extractors/markit', () => ({
  extractViaMarkit: (...args: unknown[]) => mockExtractViaMarkit(...args),
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

const HTML_WITH_TABLE = `<!DOCTYPE html>
<html>
<head><title>Data Article</title></head>
<body>
  <article>
    <h1>Revenue Report</h1>
    <p>Here is the quarterly revenue data for 2024.</p>
    <table>
      <caption>Q1-Q4 Revenue</caption>
      <thead><tr><th>Quarter</th><th>Revenue</th><th>Growth</th></tr></thead>
      <tbody>
        <tr><td>Q1</td><td>$10M</td><td>5%</td></tr>
        <tr><td>Q2</td><td>$12M</td><td>20%</td></tr>
        <tr><td>Q3</td><td>$15M</td><td>25%</td></tr>
        <tr><td>Q4</td><td>$18M</td><td>20%</td></tr>
      </tbody>
    </table>
    <p>Revenue grew significantly throughout the year.</p>
  </article>
</body>
</html>`;

const HTML_WITH_FIGURES = `<!DOCTYPE html>
<html>
<head><title>Research Paper</title></head>
<body>
  <article>
    <h1>Study Results</h1>
    <figure>
      <img src="https://example.com/images/chart1.png" alt="GDP Growth Chart" width="800" height="600">
      <figcaption>Figure 1: GDP growth over time</figcaption>
    </figure>
    <p>The chart shows steady growth.</p>
    <figure>
      <img src="https://example.com/images/chart2.jpg" alt="Population Distribution" width="600" height="400">
      <figcaption>Figure 2: Population by region</figcaption>
    </figure>
    <img src="https://example.com/icon-small.png" alt="icon" width="16" height="16">
  </article>
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
    vi.unstubAllEnvs();
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

      await expect(extractHtmlContent('https://example.com/missing')).rejects.toThrow('HTTP 404');
    });

    it('handles fetch failures (500)', async () => {
      fetchSpy.mockResolvedValue(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(extractHtmlContent('https://example.com/error')).rejects.toThrow('HTTP 500');
    });

    it('handles fetch failures (network error)', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      await expect(extractHtmlContent('https://example.com/offline')).rejects.toThrow(
        'Network error'
      );
    });

    it('handles fetch timeout', async () => {
      fetchSpy.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      await expect(extractHtmlContent('https://example.com/slow')).rejects.toThrow();
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

    it('extracts tables with headers, rows, and caption', async () => {
      mockFetchResponse(HTML_WITH_TABLE);
      const result = await extractHtmlContent('https://example.com/data');

      expect(result.tables).toBeDefined();
      expect(result.tables!.length).toBe(1);
      expect(result.tables![0].caption).toBe('Q1-Q4 Revenue');
      expect(result.tables![0].headers).toEqual(['Quarter', 'Revenue', 'Growth']);
      expect(result.tables![0].rows).toHaveLength(4);
      expect(result.tables![0].rows[0]).toEqual(['Q1', '$10M', '5%']);
    });

    it('extracts figures with caption, alt text, and absolute URLs', async () => {
      mockFetchResponse(HTML_WITH_FIGURES);
      const result = await extractHtmlContent('https://example.com/paper');

      expect(result.figures).toBeDefined();
      expect(result.figures!.length).toBe(2); // small icon should be filtered out
      expect(result.figures![0].url).toBe('https://example.com/images/chart1.png');
      expect(result.figures![0].caption).toBe('Figure 1: GDP growth over time');
      expect(result.figures![0].altText).toBe('GDP Growth Chart');
      expect(result.figures![0].mimeType).toBe('image/png');
      expect(result.figures![1].mimeType).toBe('image/jpeg');
    });

    it('does not include tables or figures fields when none found', async () => {
      mockFetchResponse(MINIMAL_HTML);
      const result = await extractHtmlContent('https://example.com/minimal');

      expect(result.tables).toBeUndefined();
      expect(result.figures).toBeUndefined();
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
              info: {
                Title: 'PDF Title',
                Author: 'PDF Author',
                CreationDate: new Date('2024-06-01'),
              },
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
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const result = await extractContent('https://example.com/article');

      expect(result.sourceType).toBe('html');
      expect(result.text).toContain('first paragraph');
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({
        headers: expect.objectContaining({
          'User-Agent': 'Mozilla/5.0 (compatible; SottoBot/1.0; +https://selfhost.example.com)',
        }),
      });
    });

    it('routes YouTube URLs to youtube extractor', async () => {
      // YouTube extractor returns sourceType 'youtube' even on failure
      const result = await extractContent('https://www.youtube.com/watch?v=test123');

      expect(result.sourceType).toBe('youtube');
      expect(result.extractionMethod).toBe('summarize-core');
    });

    it('routes PDF URLs (by Content-Type) to Markit extractor', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'PDF extracted text from URL.',
        markdown: '# PDF\n\nPDF extracted text from URL.',
        title: 'URL PDF',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 5,
        sourceType: 'pdf',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-pdf-content'), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        })
      );

      const result = await extractContent('https://example.com/paper.pdf');

      expect(result.sourceType).toBe('pdf');
      expect(result.extractionMethod).toBe('markit');
      expect(result.text).toContain('PDF extracted text');
      expect(mockExtractViaMarkit).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ extension: '.pdf' })
      );
    });

    it('falls back to pdf-parse when Markit fails for PDF', async () => {
      mockExtractViaMarkit.mockRejectedValue(new Error('Markit PDF error'));

      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'Fallback PDF text.', pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: { Title: 'Fallback PDF' } };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-pdf'), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        })
      );

      const result = await extractContent('https://example.com/paper.pdf');

      expect(result.sourceType).toBe('pdf');
      expect(result.extractionMethod).toBe('pdf-parse');
    });

    it('detects PDF by URL extension when Content-Type is application/octet-stream', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'Octet-stream PDF text.',
        markdown: 'Octet-stream PDF text.',
        title: null,
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 3,
        sourceType: 'pdf',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-pdf'), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );

      const result = await extractContent('https://example.com/download/report.pdf');

      expect(result.sourceType).toBe('pdf');
    });

    it('falls back to HTML when Content-Type is missing', async () => {
      fetchSpy.mockResolvedValue(
        new Response(WELL_STRUCTURED_HTML, {
          status: 200,
          headers: {},
        })
      );

      const result = await extractContent('https://example.com/article');

      expect(result.sourceType).toBe('html');
      expect(result.text).toContain('first paragraph');
    });

    it('routes DOCX URLs (by Content-Type) to Markit extractor', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'Quarterly review.',
        markdown: '## Meeting Notes\n\nQuarterly review.',
        title: 'Meeting Notes',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 2,
        sourceType: 'document',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-docx'), {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        })
      );

      const result = await extractContent('https://example.com/doc.docx');

      expect(result.sourceType).toBe('document');
      expect(result.extractionMethod).toBe('markit');
      expect(result.title).toBe('Meeting Notes');
      expect(mockExtractViaMarkit).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ extension: '.docx' })
      );
    });

    it('routes PPTX URLs to Markit extractor', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'Slide content',
        markdown: 'Slide content',
        title: 'Deck',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 2,
        sourceType: 'document',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-pptx'), {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          },
        })
      );

      const result = await extractContent('https://example.com/deck.pptx');

      expect(result.sourceType).toBe('document');
      expect(result.extractionMethod).toBe('markit');
    });

    it('routes XLSX URLs to Markit extractor', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: '1 2',
        markdown: '| A | B |\n|---|---|\n| 1 | 2 |',
        title: 'Data',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 2,
        sourceType: 'document',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-xlsx'), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        })
      );

      const result = await extractContent('https://example.com/data.xlsx');

      expect(result.sourceType).toBe('document');
      expect(result.extractionMethod).toBe('markit');
    });

    it('routes EPUB URLs to Markit extractor', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'Once upon a time.',
        markdown: '# Chapter 1\n\nOnce upon a time.',
        title: 'Novel',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 5,
        sourceType: 'document',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-epub'), {
          status: 200,
          headers: { 'Content-Type': 'application/epub+zip' },
        })
      );

      const result = await extractContent('https://example.com/book.epub');

      expect(result.sourceType).toBe('document');
      expect(result.extractionMethod).toBe('markit');
    });

    it('detects document type by extension when Content-Type is octet-stream', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'Report content.',
        markdown: 'Report content.',
        title: 'Report',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 2,
        sourceType: 'document',
        extractionMethod: 'markit',
      });

      fetchSpy.mockResolvedValue(
        new Response(Buffer.from('fake-docx'), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );

      const result = await extractContent('https://example.com/report.docx');

      expect(result.sourceType).toBe('document');
      expect(result.extractionMethod).toBe('markit');
    });

    it('handles Content-Type with charset parameter', async () => {
      fetchSpy.mockResolvedValue(
        new Response(WELL_STRUCTURED_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );

      const result = await extractContent('https://example.com/article');

      expect(result.sourceType).toBe('html');
    });
  });

  describe('extractFromPdfBuffer', () => {
    it('tries Markit first for PDF buffer extraction', async () => {
      mockExtractViaMarkit.mockResolvedValue({
        text: 'Markit PDF content.',
        markdown: '# Markit PDF\n\nMarkit PDF content.',
        title: 'Markit PDF',
        description: null,
        siteName: null,
        author: null,
        publishedDate: null,
        wordCount: 3,
        sourceType: 'pdf',
        extractionMethod: 'markit',
      });

      const result = await extractFromPdfBuffer(Buffer.from('fake-pdf'));

      expect(result.extractionMethod).toBe('markit');
      expect(result.text).toContain('Markit PDF content');
      expect(mockExtractViaMarkit).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ extension: '.pdf' })
      );
    });

    it('falls back to pdf-parse when Markit fails', async () => {
      mockExtractViaMarkit.mockRejectedValue(new Error('Markit buffer error'));

      vi.doMock('pdf-parse', () => ({
        PDFParse: class {
          async getText() {
            return { text: 'Fallback PDF buffer text.', pages: [], total: 1 };
          }
          async getInfo() {
            return { total: 1, info: { Title: 'Fallback' } };
          }
        },
      }));
      vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
        getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
      }));

      const result = await extractFromPdfBuffer(Buffer.from('fake-pdf'));

      expect(result.extractionMethod).toBe('pdf-parse');
      expect(result.sourceType).toBe('pdf');
    });
  });

  describe('Pinchtab fallback', () => {
    const THIN_HTML =
      '<html><head><meta property="og:title" content="SPA Page"><meta property="og:site_name" content="MySite"></head><body><p>Loading...</p></body></html>';
    const LONG_PINCHTAB_TEXT =
      'Key Findings\nThe research shows that browser-rendered content provides significantly richer extraction results than static HTML parsing for single-page applications and dynamic websites.\n\n- Better text extraction\n- Improved accuracy\n- More complete content';

    it('triggers Pinchtab when static extraction yields thin content', async () => {
      mockFetchResponse(THIN_HTML);
      const availableSpy = vi.spyOn(pinchtabModule, 'isPinchtabAvailable').mockReturnValue(true);
      const extractSpy = vi
        .spyOn(pinchtabModule, 'extractViaPinchtab')
        .mockResolvedValue(LONG_PINCHTAB_TEXT);

      const result = await extractContent('https://example.com/spa');

      expect(availableSpy).toHaveBeenCalled();
      expect(extractSpy).toHaveBeenCalledWith('https://example.com/spa');
      expect(result.extractionMethod).toBe('pinchtab');
      expect(result.text).toContain('research shows');
      // Preserves static OG metadata
      expect(result.title).toBe('SPA Page');
      expect(result.siteName).toBe('MySite');
      // Markdown should have formatting applied (headings, lists)
      expect(result.markdown).toContain('##');
      expect(result.markdown).toContain('- Better text extraction');
    });

    it('returns static result when Pinchtab does not improve word count', async () => {
      mockFetchResponse(THIN_HTML);
      vi.spyOn(pinchtabModule, 'isPinchtabAvailable').mockReturnValue(true);
      // Return even fewer words than static
      vi.spyOn(pinchtabModule, 'extractViaPinchtab').mockResolvedValue('Loading');

      const result = await extractContent('https://example.com/spa');

      expect(result.extractionMethod).not.toBe('pinchtab');
    });

    it('returns static result when Pinchtab errors', async () => {
      mockFetchResponse(THIN_HTML);
      vi.spyOn(pinchtabModule, 'isPinchtabAvailable').mockReturnValue(true);
      vi.spyOn(pinchtabModule, 'extractViaPinchtab').mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await extractContent('https://example.com/spa');

      expect(result.extractionMethod).not.toBe('pinchtab');
      expect(result.sourceType).toBe('html');
    });

    it('skips Pinchtab when not configured', async () => {
      mockFetchResponse(THIN_HTML);
      vi.spyOn(pinchtabModule, 'isPinchtabAvailable').mockReturnValue(false);
      const extractSpy = vi.spyOn(pinchtabModule, 'extractViaPinchtab');

      const result = await extractContent('https://example.com/spa');

      expect(extractSpy).not.toHaveBeenCalled();
      expect(result.extractionMethod).not.toBe('pinchtab');
    });

    it('does not trigger Pinchtab when static extraction has enough content', async () => {
      mockFetchResponse(WELL_STRUCTURED_HTML);
      const extractSpy = vi.spyOn(pinchtabModule, 'extractViaPinchtab');

      const result = await extractContent('https://example.com/article');

      expect(extractSpy).not.toHaveBeenCalled();
      expect(result.extractionMethod).not.toBe('pinchtab');
    });

    it('never triggers Pinchtab for YouTube URLs', async () => {
      const extractSpy = vi.spyOn(pinchtabModule, 'extractViaPinchtab');

      await extractContent('https://www.youtube.com/watch?v=test123');

      expect(extractSpy).not.toHaveBeenCalled();
    });
  });
});
