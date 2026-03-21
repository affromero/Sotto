export interface ExtractedTable {
  caption: string | null;
  headers: string[];
  rows: string[][];
  sourceLabel: string | null;
}

export interface ExtractedFigure {
  url: string;
  caption: string | null;
  altText: string | null;
  sourceLabel: string | null;
  mimeType: string;
}

export interface ExtractedStatistic {
  label: string;
  value: string;
  unit: string | null;
  context: string | null;
}

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
  /** Structured tables extracted from the source */
  tables?: ExtractedTable[];
  /** Figures/images extracted from the source */
  figures?: ExtractedFigure[];
  /** Key statistics found in the source */
  keyStatistics?: ExtractedStatistic[];
}
