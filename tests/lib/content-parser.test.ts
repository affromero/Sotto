import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock pdf-parse
const mockPdfParse = vi.fn();
vi.mock('pdf-parse', () => ({
  default: mockPdfParse,
}));

// Mock global fetch
global.fetch = vi.fn();

import { extractFromUrl, extractFromPdf } from '@/lib/content-parser';

describe('content-parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractFromUrl', () => {
    it('fetches and extracts text from HTML', async () => {
      const html = '<html><body><h1>Title</h1><p>Content paragraph.</p></body></html>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(global.fetch).toHaveBeenCalledWith('https://example.com');
      expect(result).toContain('Title');
      expect(result).toContain('Content paragraph');
    });

    it('removes script tags from HTML', async () => {
      const html = '<html><body><script>alert("bad")</script><p>Good content</p></body></html>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('alert');
      expect(result).toContain('Good content');
    });

    it('removes style tags from HTML', async () => {
      const html =
        '<html><head><style>body { color: red; }</style></head><body><p>Content</p></body></html>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('color: red');
      expect(result).toContain('Content');
    });

    it('strips all HTML tags', async () => {
      const html = '<div><span><strong>Bold</strong> and <em>italic</em></span></div>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('Bold');
      expect(result).toContain('italic');
    });

    it('collapses multiple spaces into single space', async () => {
      const html = '<p>Text   with    multiple     spaces</p>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('Text with multiple spaces');
    });

    it('trims leading and trailing whitespace', async () => {
      const html = '   <p>Content</p>   ';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('Content');
    });

    it('limits output to 50000 characters', async () => {
      const longText = 'a'.repeat(60000);
      const html = `<p>${longText}</p>`;
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result.length).toBe(50000);
    });

    it('throws error when fetch fails with non-ok status', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(extractFromUrl('https://example.com/notfound')).rejects.toThrow(
        'Failed to fetch URL: 404'
      );
    });

    it('throws error when fetch fails with 500 status', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(extractFromUrl('https://example.com/error')).rejects.toThrow(
        'Failed to fetch URL: 500'
      );
    });

    it('throws error when fetch rejects with network error', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      await expect(extractFromUrl('https://example.com')).rejects.toThrow('Network error');
    });

    it('handles empty HTML body', async () => {
      const html = '<html><body></body></html>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('');
    });

    it('handles HTML with only whitespace', async () => {
      const html = '<html><body>   \n\n   </body></html>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('');
    });

    it('handles complex nested HTML structure', async () => {
      const html = `
        <html>
          <head><title>Ignored</title></head>
          <body>
            <header><nav><a href="#">Link</a></nav></header>
            <main>
              <article>
                <h1>Main Title</h1>
                <p>First paragraph.</p>
                <p>Second paragraph.</p>
              </article>
            </main>
            <footer>Footer content</footer>
          </body>
        </html>
      `;
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toContain('Main Title');
      expect(result).toContain('First paragraph');
      expect(result).toContain('Footer content');
    });

    it('handles special characters in HTML', async () => {
      const html = '<p>Special chars: &lt; &gt; &amp; &quot;</p>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toContain('Special chars');
    });

    it('handles multiple script tags', async () => {
      const html = '<script>bad1</script><p>Good</p><script>bad2</script>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('bad1');
      expect(result).not.toContain('bad2');
      expect(result).toContain('Good');
    });

    it('handles multiple style tags', async () => {
      const html = '<style>css1</style><p>Content</p><style>css2</style>';
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        text: async () => html,
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('css1');
      expect(result).not.toContain('css2');
      expect(result).toContain('Content');
    });
  });

  describe('extractFromPdf', () => {
    it('extracts text from PDF buffer', async () => {
      const buffer = Buffer.from('fake pdf content');
      mockPdfParse.mockResolvedValue({
        numpages: 3,
        text: 'PDF text content here',
      });

      const result = await extractFromPdf(buffer);

      expect(mockPdfParse).toHaveBeenCalledWith(buffer);
      expect(result).toBe('PDF text content here');
    });

    it('limits output to 50000 characters', async () => {
      const buffer = Buffer.from('fake pdf');
      const longText = 'b'.repeat(60000);
      mockPdfParse.mockResolvedValue({
        numpages: 100,
        text: longText,
      });

      const result = await extractFromPdf(buffer);

      expect(result.length).toBe(50000);
    });

    it('handles multi-page PDFs', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 10,
        text: 'Content from multiple pages',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('Content from multiple pages');
    });

    it('handles single page PDF', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 1,
        text: 'Single page content',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('Single page content');
    });

    it('handles empty PDF', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 0,
        text: '',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('');
    });

    it('handles PDF with only whitespace', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 1,
        text: '   \n\n   ',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('   \n\n   ');
    });

    it('throws error when PDF parsing fails', async () => {
      const buffer = Buffer.from('corrupt pdf');
      mockPdfParse.mockRejectedValue(new Error('Invalid PDF structure'));

      await expect(extractFromPdf(buffer)).rejects.toThrow('Invalid PDF structure');
    });

    it('handles PDF with special characters', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 1,
        text: 'Text with unicode: café, naïve, 日本語',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toContain('café');
      expect(result).toContain('naïve');
      expect(result).toContain('日本語');
    });

    it('handles PDF with newlines and formatting', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 2,
        text: 'Line 1\nLine 2\n\nLine 3',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('Line 1\nLine 2\n\nLine 3');
    });

    it('handles large PDF at exactly 50000 characters', async () => {
      const buffer = Buffer.from('fake pdf');
      const exactText = 'c'.repeat(50000);
      mockPdfParse.mockResolvedValue({
        numpages: 50,
        text: exactText,
      });

      const result = await extractFromPdf(buffer);

      expect(result.length).toBe(50000);
    });

    it('handles PDF parse result with default export', async () => {
      const buffer = Buffer.from('fake pdf');
      const mockDefaultParse = vi.fn().mockResolvedValue({
        numpages: 1,
        text: 'Default export content',
      });
      mockPdfParse.mockImplementation(mockDefaultParse);

      const result = await extractFromPdf(buffer);

      expect(result).toBe('Default export content');
    });

    it('handles empty buffer', async () => {
      const buffer = Buffer.from('');
      mockPdfParse.mockRejectedValue(new Error('Empty buffer'));

      await expect(extractFromPdf(buffer)).rejects.toThrow('Empty buffer');
    });

    it('preserves paragraph structure in PDF text', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 2,
        text: 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toContain('Paragraph 1');
      expect(result).toContain('\n\n');
      expect(result).toContain('Paragraph 3');
    });

    it('handles PDF with numbers and symbols', async () => {
      const buffer = Buffer.from('fake pdf');
      mockPdfParse.mockResolvedValue({
        numpages: 1,
        text: 'Data: 123, 456.78, 90% of $100',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toContain('123');
      expect(result).toContain('456.78');
      expect(result).toContain('90%');
      expect(result).toContain('$100');
    });

    it('truncates at 50000 chars even with multi-byte unicode', async () => {
      const buffer = Buffer.from('fake pdf');
      const longText = '日'.repeat(30000);
      mockPdfParse.mockResolvedValue({
        numpages: 100,
        text: longText,
      });

      const result = await extractFromPdf(buffer);

      expect(result.length).toBeLessThanOrEqual(50000);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
