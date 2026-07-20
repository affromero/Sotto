import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConvert = vi.fn();

vi.mock('markit-ai', () => ({
  Markit: class {
    convert(...args: unknown[]) {
      return mockConvert(...args);
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { extractViaMarkit } from '@/lib/extractors/markit';

describe('markit extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts a PDF buffer and returns ExtractedContent', async () => {
    mockConvert.mockResolvedValue({
      markdown: '# Research Paper\n\nThis is the abstract of the paper.',
      title: 'Research Paper',
    });

    const buffer = Buffer.from('fake-pdf');
    const result = await extractViaMarkit(buffer, {
      extension: '.pdf',
      url: 'https://example.com/paper.pdf',
    });

    expect(result.sourceType).toBe('pdf');
    expect(result.extractionMethod).toBe('markit');
    expect(result.title).toBe('Research Paper');
    expect(result.markdown).toContain('# Research Paper');
    expect(result.text).toContain('Research Paper');
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it('converts a DOCX buffer with sourceType document', async () => {
    mockConvert.mockResolvedValue({
      markdown: '## Meeting Notes\n\nDiscussed quarterly targets.',
      title: 'Meeting Notes',
    });

    const buffer = Buffer.from('fake-docx');
    const result = await extractViaMarkit(buffer, {
      extension: '.docx',
      url: 'https://example.com/notes.docx',
    });

    expect(result.sourceType).toBe('document');
    expect(result.extractionMethod).toBe('markit');
    expect(result.title).toBe('Meeting Notes');
  });

  it('converts PPTX with sourceType document', async () => {
    mockConvert.mockResolvedValue({
      markdown: 'Slide 1: Introduction\n\nSlide 2: Overview',
      title: 'Presentation',
    });

    const buffer = Buffer.from('fake-pptx');
    const result = await extractViaMarkit(buffer, {
      extension: '.pptx',
      url: 'https://example.com/deck.pptx',
    });

    expect(result.sourceType).toBe('document');
  });

  it('converts XLSX with sourceType document', async () => {
    mockConvert.mockResolvedValue({
      markdown: '| Col A | Col B |\n|---|---|\n| 1 | 2 |',
      title: 'Spreadsheet',
    });

    const buffer = Buffer.from('fake-xlsx');
    const result = await extractViaMarkit(buffer, {
      extension: '.xlsx',
      url: 'https://example.com/data.xlsx',
    });

    expect(result.sourceType).toBe('document');
  });

  it('converts EPUB with sourceType document', async () => {
    mockConvert.mockResolvedValue({
      markdown: '# Chapter 1\n\nIt was a dark and stormy night.',
      title: 'Novel',
    });

    const buffer = Buffer.from('fake-epub');
    const result = await extractViaMarkit(buffer, {
      extension: '.epub',
      url: 'https://example.com/book.epub',
    });

    expect(result.sourceType).toBe('document');
    expect(result.title).toBe('Novel');
  });

  it('passes extension to markit.convert', async () => {
    mockConvert.mockResolvedValue({ markdown: 'content', title: null });

    const buffer = Buffer.from('fake');
    await extractViaMarkit(buffer, { extension: '.docx', url: 'https://example.com/doc.docx' });

    expect(mockConvert).toHaveBeenCalledWith(buffer, { extension: '.docx' });
  });

  it('truncates content at MAX_CONTENT_LENGTH', async () => {
    mockConvert.mockResolvedValue({
      markdown: 'x'.repeat(60000),
      title: 'Long Document',
    });

    const buffer = Buffer.from('fake');
    const result = await extractViaMarkit(buffer, {
      extension: '.pdf',
      url: 'https://example.com/long.pdf',
    });

    expect(result.markdown.length).toBeLessThanOrEqual(50000);
    expect(result.text.length).toBeLessThanOrEqual(50000);
  });

  it('handles null title from Markit', async () => {
    mockConvert.mockResolvedValue({
      markdown: 'Some content without a title.',
      title: undefined,
    });

    const buffer = Buffer.from('fake');
    const result = await extractViaMarkit(buffer, {
      extension: '.pdf',
      url: 'https://example.com/notitle.pdf',
    });

    expect(result.title).toBeNull();
  });

  it('handles empty markdown from Markit', async () => {
    mockConvert.mockResolvedValue({
      markdown: '',
      title: null,
    });

    const buffer = Buffer.from('fake');
    const result = await extractViaMarkit(buffer, {
      extension: '.pdf',
      url: 'https://example.com/empty.pdf',
    });

    expect(result.text).toBe('');
    expect(result.markdown).toBe('');
    expect(result.wordCount).toBe(0);
  });

  it('propagates Markit errors', async () => {
    mockConvert.mockRejectedValue(new Error('Unsupported format'));

    const buffer = Buffer.from('fake');
    await expect(
      extractViaMarkit(buffer, { extension: '.xyz', url: 'https://example.com/file.xyz' })
    ).rejects.toThrow('Unsupported format');
  });

  it('strips markdown syntax from text field', async () => {
    mockConvert.mockResolvedValue({
      markdown: '# Heading\n\n**Bold** and *italic* with [link](url)',
      title: 'Test',
    });

    const buffer = Buffer.from('fake');
    const result = await extractViaMarkit(buffer, {
      extension: '.docx',
      url: 'https://example.com/doc.docx',
    });

    expect(result.text).not.toContain('#');
    expect(result.text).not.toContain('**');
    expect(result.text).not.toContain('*');
    expect(result.text).toContain('Heading');
    expect(result.text).toContain('Bold');
  });
});
