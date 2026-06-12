// Persist generator-produced references for a episode. Shared between the
// episode script-generation worker pattern and sourced-class listening
// generation. Maps ALL 8 GeneratedReference fields onto Reference rows.
import { prisma } from './prisma';
import type { GeneratedReference } from './script-generator';

/**
 * Persist generated references for a episode. No-op when there are none.
 * Uses `skipDuplicates` so a re-run (idempotent retry) does not violate the
 * `@@unique([episodeId, number])` constraint.
 */
export async function persistGeneratedReferences(
  episodeId: string,
  refs: GeneratedReference[],
): Promise<void> {
  if (refs.length === 0) return;

  await prisma.reference.createMany({
    data: refs.map((r) => ({
      episodeId,
      number: r.number,
      title: r.title,
      authors: r.authors,
      year: r.year,
      url: r.url,
      type: r.type,
      publisher: r.publisher,
      doi: r.doi,
    })),
    skipDuplicates: true,
  });
}
