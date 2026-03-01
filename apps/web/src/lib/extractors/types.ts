export interface ExtractedContent {
  /** Plain text content (no HTML) */
  text: string;
  /** Markdown-formatted content (preferred for script generation) */
  markdown: string;
  /** Page/article title */
  title: string | null;
  /** Meta description or excerpt */
  description: string | null;
  /** Website name (e.g. "The New York Times") */
  siteName: string | null;
  /** Author name(s) */
  author: string | null;
  /** ISO date string of publication */
  publishedDate: string | null;
  /** Word count of extracted text */
  wordCount: number;
  /** Source type: html, pdf, youtube, video */
  sourceType: 'html' | 'pdf' | 'youtube' | 'video';
  /** Which extraction method succeeded */
  extractionMethod: 'readability' | 'cheerio-fallback' | 'pdf-parse' | 'youtube-transcript' | 'summarize-core' | 'pinchtab';
}
