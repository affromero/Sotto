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

// Mock the extractors module (content-parser delegates to it)
const mockExtractContent = vi.fn();
const mockExtractFromPdfBuffer = vi.fn();
vi.mock('@/lib/extractors', () => ({
  extractContent: (...args: unknown[]) => mockExtractContent(...args),
  extractFromPdfBuffer: (...args: unknown[]) => mockExtractFromPdfBuffer(...args),
}));

import { extractFromUrl, extractFromPdf } from '@/lib/content-parser';

describe('content-parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractFromUrl', () => {
    it('fetches and extracts text from HTML', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Title Content paragraph.',
        markdown: '# Title\nContent paragraph.',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(mockExtractContent).toHaveBeenCalledWith('https://example.com');
      expect(result).toContain('Title');
      expect(result).toContain('Content paragraph');
    });

    it('removes script tags from HTML', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Good content',
        markdown: 'Good content',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('alert');
      expect(result).toContain('Good content');
    });

    it('removes style tags from HTML', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Content',
        markdown: 'Content',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('color: red');
      expect(result).toContain('Content');
    });

    it('strips all HTML tags', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Bold and italic',
        markdown: '**Bold** and *italic*',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('Bold');
      expect(result).toContain('italic');
    });

    it('collapses multiple spaces into single space', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Text with multiple spaces',
        markdown: 'Text with multiple spaces',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('Text with multiple spaces');
    });

    it('trims leading and trailing whitespace', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Content',
        markdown: 'Content',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('Content');
    });

    it('limits output to 50000 characters', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'a'.repeat(50000),
        markdown: 'a'.repeat(50000),
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result.length).toBeLessThanOrEqual(50000);
    });

    it('throws error when fetch fails with non-ok status', async () => {
      mockExtractContent.mockRejectedValue(new Error('HTTP 404: Not Found'));

      await expect(extractFromUrl('https://example.com/notfound')).rejects.toThrow('HTTP 404');
    });

    it('throws error when fetch rejects with network error', async () => {
      mockExtractContent.mockRejectedValue(new Error('Network error'));

      await expect(extractFromUrl('https://example.com')).rejects.toThrow('Network error');
    });

    it('handles empty HTML body', async () => {
      mockExtractContent.mockResolvedValue({
        text: '',
        markdown: '',
        sourceType: 'html',
        extractionMethod: 'cheerio-fallback',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('');
    });

    it('handles HTML with only whitespace', async () => {
      mockExtractContent.mockResolvedValue({
        text: '',
        markdown: '',
        sourceType: 'html',
        extractionMethod: 'cheerio-fallback',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toBe('');
    });

    it('handles complex nested HTML structure', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Main Title First paragraph. Second paragraph.',
        markdown: '# Main Title\nFirst paragraph.\nSecond paragraph.',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toContain('Main Title');
      expect(result).toContain('First paragraph');
    });

    it('handles special characters in HTML', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Special chars: < > & "',
        markdown: 'Special chars: < > & "',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).toContain('Special chars');
    });

    it('handles multiple script tags', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Good',
        markdown: 'Good',
        sourceType: 'html',
        extractionMethod: 'readability',
      });

      const result = await extractFromUrl('https://example.com');

      expect(result).not.toContain('bad1');
      expect(result).not.toContain('bad2');
      expect(result).toContain('Good');
    });

    it('handles multiple style tags', async () => {
      mockExtractContent.mockResolvedValue({
        text: 'Content',
        markdown: 'Content',
        sourceType: 'html',
        extractionMethod: 'readability',
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
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: 'PDF text content here',
        markdown: 'PDF text content here',
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(mockExtractFromPdfBuffer).toHaveBeenCalledWith(buffer);
      expect(result).toBe('PDF text content here');
    });

    it('limits output to 50000 characters', async () => {
      const buffer = Buffer.from('fake pdf');
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: 'b'.repeat(50000),
        markdown: 'b'.repeat(50000),
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result.length).toBeLessThanOrEqual(50000);
    });

    it('handles empty PDF', async () => {
      const buffer = Buffer.from('fake pdf');
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: '',
        markdown: '',
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('');
    });

    it('handles PDF with only whitespace', async () => {
      const buffer = Buffer.from('fake pdf');
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: '   \n\n   ',
        markdown: '   \n\n   ',
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('   \n\n   ');
    });

    it('throws error when PDF parsing fails', async () => {
      const buffer = Buffer.from('corrupt pdf');
      mockExtractFromPdfBuffer.mockRejectedValue(new Error('Invalid PDF structure'));

      await expect(extractFromPdf(buffer)).rejects.toThrow('Invalid PDF structure');
    });

    it('handles PDF with special characters', async () => {
      const buffer = Buffer.from('fake pdf');
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: 'Text with unicode: café, naïve, 日本語',
        markdown: 'Text with unicode: café, naïve, 日本語',
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toContain('café');
      expect(result).toContain('naïve');
      expect(result).toContain('日本語');
    });

    it('handles PDF with newlines and formatting', async () => {
      const buffer = Buffer.from('fake pdf');
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: 'Line 1\nLine 2\n\nLine 3',
        markdown: 'Line 1\nLine 2\n\nLine 3',
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result).toBe('Line 1\nLine 2\n\nLine 3');
    });

    it('handles large PDF at exactly 50000 characters', async () => {
      const buffer = Buffer.from('fake pdf');
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: 'c'.repeat(50000),
        markdown: 'c'.repeat(50000),
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result.length).toBe(50000);
    });

    it('handles empty buffer', async () => {
      const buffer = Buffer.from('');
      mockExtractFromPdfBuffer.mockRejectedValue(new Error('Empty buffer'));

      await expect(extractFromPdf(buffer)).rejects.toThrow('Empty buffer');
    });

    it('truncates at 50000 chars even with multi-byte unicode', async () => {
      const buffer = Buffer.from('fake pdf');
      const longText = '日'.repeat(30000);
      mockExtractFromPdfBuffer.mockResolvedValue({
        text: longText,
        markdown: longText,
        sourceType: 'pdf',
        extractionMethod: 'pdf-parse',
      });

      const result = await extractFromPdf(buffer);

      expect(result.length).toBeLessThanOrEqual(50000);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
