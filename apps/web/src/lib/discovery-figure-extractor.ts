import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { extractHtmlContent } from '@/lib/extractors/html';
import { logger } from '@/lib/logger';
import type { ExtractedFigure, ExtractedTable } from '@/lib/extractors/types';
import { Prisma } from '@/generated/prisma/client';

const MAX_DISCOVERY_FIGURES = 20;
const MAX_DISCOVERY_TABLES = 10;
const MAX_REFS_TO_EXTRACT = 5; // Don't try too many — diminishing returns

interface VerifiedRef {
  id: string;
  url: string | null;
  title: string;
  number: number;
}

/**
 * Extract figures and tables from verified reference URLs and merge
 * them into Discovery.sourceMetadata.discoveryFigures / discoveryTables.
 *
 * Each figure/table gets a sourceLabel with attribution to the reference.
 */
export async function extractDiscoveryFigures(
  episodeId: string,
  verifiedRefs: VerifiedRef[],
): Promise<void> {
  const refsWithUrls = verifiedRefs
    .filter((r) => r.url)
    .slice(0, MAX_REFS_TO_EXTRACT);

  if (refsWithUrls.length === 0) return;

  const allFigures: ExtractedFigure[] = [];
  const allTables: ExtractedTable[] = [];

  // Extract from each reference URL (parallel, best-effort)
  const results = await Promise.allSettled(
    refsWithUrls.map(async (ref) => {
      try {
        const extracted = await extractHtmlContent(ref.url!);
        const sourceLabel = `[${ref.number}] ${ref.title}`;

        const figures = (extracted.figures || []).map((f) => ({
          ...f,
          sourceLabel,
        }));

        const tables = (extracted.tables || []).map((t) => ({
          ...t,
          sourceLabel,
        }));

        return { figures, tables };
      } catch (err) {
        logger.warn('Failed to extract figures from reference URL', {
          refId: ref.id,
          url: ref.url,
          error: (err as Error).message,
        });
        return { figures: [], tables: [] };
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allFigures.push(...result.value.figures);
      allTables.push(...result.value.tables);
    }
  }

  if (allFigures.length === 0 && allTables.length === 0) return;

  // Merge into Discovery.sourceMetadata
  const discovery = await prisma.discovery.findUnique({
    where: { episodeId },
    select: { sourceMetadata: true },
  });

  const existing = (discovery?.sourceMetadata as Record<string, unknown>) || {};

  const updatedMetadata = {
    ...existing,
    discoveryFigures: allFigures.slice(0, MAX_DISCOVERY_FIGURES),
    discoveryTables: allTables.slice(0, MAX_DISCOVERY_TABLES),
  };

  await prisma.discovery.update({
    where: { episodeId },
    data: {
      sourceMetadata: JSON.parse(JSON.stringify(updatedMetadata)) as Prisma.InputJsonValue,
    },
  });

  logger.info('Discovery figures extracted from verified references', {
    episodeId,
    figures: String(Math.min(allFigures.length, MAX_DISCOVERY_FIGURES)),
    tables: String(Math.min(allTables.length, MAX_DISCOVERY_TABLES)),
    refsProcessed: String(refsWithUrls.length),
  });
}
