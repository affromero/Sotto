import { extractHtmlContent } from './html';
import { countWords, MAX_CONTENT_LENGTH } from './html';
import { extractPdfContent } from './pdf';
import { isPinchtabAvailable, extractViaPinchtab } from './pinchtab';
import { isYouTubeUrl, extractYouTubeContent } from './youtube';
import { logger } from '../logger';
import type { ExtractedContent } from './types';

export type { ExtractedContent, ExtractedTable, ExtractedFigure, ExtractedStatistic } from './types';

const MIN_WORD_COUNT = 50;

/**
 * Extract content from a URL, routing to the appropriate extractor.
 * Order: YouTube → HTML (with Pinchtab fallback for thin content)
 */
export async function extractContent(url: string): Promise<ExtractedContent> {
  logger.info('Extracting content', { url });

  if (isYouTubeUrl(url)) {
    return extractYouTubeContent(url);
  }

  const htmlResult = await extractHtmlContent(url);

  if (htmlResult.wordCount >= MIN_WORD_COUNT) {
    return htmlResult;
  }

  if (!isPinchtabAvailable()) {
    logger.info('Thin extraction, Pinchtab not configured', { url, wordCount: htmlResult.wordCount });
    return htmlResult;
  }

  try {
    logger.info('Thin extraction, trying Pinchtab fallback', { url, wordCount: htmlResult.wordCount });
    const pinchtabText = await extractViaPinchtab(url);
    const pinchtabWordCount = countWords(pinchtabText);

    if (pinchtabWordCount > htmlResult.wordCount) {
      logger.info('Pinchtab produced richer content', {
        url,
        staticWords: htmlResult.wordCount,
        pinchtabWords: pinchtabWordCount,
      });
      const truncated = pinchtabText.substring(0, MAX_CONTENT_LENGTH);
      return {
        text: truncated,
        markdown: truncated,
        title: htmlResult.title,
        description: htmlResult.description,
        siteName: htmlResult.siteName,
        author: htmlResult.author,
        publishedDate: htmlResult.publishedDate,
        wordCount: pinchtabWordCount,
        sourceType: 'html',
        extractionMethod: 'pinchtab',
        ...(htmlResult.tables && { tables: htmlResult.tables }),
        ...(htmlResult.figures && { figures: htmlResult.figures }),
        ...(htmlResult.keyStatistics && { keyStatistics: htmlResult.keyStatistics }),
      };
    }

    logger.info('Pinchtab did not improve extraction', { url });
    return htmlResult;
  } catch (err) {
    logger.warn('Pinchtab fallback failed', { url, error: (err as Error).message });
    return htmlResult;
  }
}

/**
 * Extract content from a PDF buffer.
 */
export async function extractFromPdfBuffer(buffer: Buffer): Promise<ExtractedContent> {
  return extractPdfContent(buffer);
}
