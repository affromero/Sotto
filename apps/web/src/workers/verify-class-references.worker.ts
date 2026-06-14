// Verify-only worker for sourced-class episodes.
//
// ⚠️ A class episode ALREADY created its segments and queued audio in
// `composeListeningContent` (via `createSegmentsAndQueueAudio`). Re-running
// `createSegmentsAndQueueAudio` is NOT idempotent: it would double-create
// segments and double-queue audio.
//
// This worker therefore verifies references and writes the per-reference
// verdicts back ONLY. It never mutates the script, never renumbers citations,
// and never creates segments or queues audio. Rejected/failed refs are badged
// FAILED (kept, not removed) so citations never need renumbering.
import { Job } from 'bullmq';
import { VerifyClassReferencesPayload } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { resolveLearningAi } from '@/lib/learning-ai';
import { type ReferenceInput } from '@/lib/reference-validator';
import { runReferenceVerification } from '@/lib/reference-verification';
import { logger } from '@/lib/logger';

export async function processVerifyClassReferences(
  job: Job<VerifyClassReferencesPayload>,
): Promise<void> {
  const { episodeId } = job.data;

  const [episode, script, references] = await Promise.all([
    prisma.episode.findUnique({
      where: { id: episodeId },
      select: { userId: true, topic: true, title: true },
    }),
    prisma.script.findUnique({
      where: { episodeId },
      select: { turns: true },
    }),
    prisma.reference.findMany({ where: { episodeId } }),
  ]);

  if (!episode || !script || references.length === 0) {
    logger.info('Skipping class reference verification — missing data or no references', {
      episodeId,
      hasEpisode: String(!!episode),
      hasScript: String(!!script),
      refCount: String(references.length),
    });
    return;
  }

  try {
    // Use the LEARNER's resolved AI (BYOK or local agent) — NOT the episode
    // pipeline resolver, which is keyed on cloud BYOK + admin credits.
    const ai = await resolveLearningAi(episode.userId);

    const refInputs: ReferenceInput[] = references.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      authors: r.authors,
      year: r.year,
      url: r.url,
      doi: r.doi,
      type: r.type,
    }));

    const turns = script.turns as Array<{ speaker: string; text: string }>;
    const topic = episode.topic || episode.title || '';

    const { results, rejectedRefIds } = await runReferenceVerification(
      refInputs,
      turns,
      topic,
      ai.apiKey,
      ai.model,
      ai.provider,
    );

    // Write back per-reference verdicts. No script mutation, no renumbering,
    // no segment creation. Rejected/unverifiable refs become FAILED so all
    // citation numbers stay stable.
    const updates = references.map((ref) => {
      if (rejectedRefIds.has(ref.id)) {
        return prisma.reference.update({
          where: { id: ref.id },
          data: {
            verificationStatus: 'FAILED',
            verificationDetails: { checks: [], verifiedAt: new Date().toISOString() },
          },
        });
      }

      const result = results.get(ref.id);
      if (!result) return null;

      const verificationDetails = {
        checks: result.checks.map((c) => ({
          layer: c.layer,
          passed: c.passed,
          confidence: c.confidence,
          detail: c.detail,
        })),
        posterior: result.score,
        verifiedAt: new Date().toISOString(),
      };

      const { verdict } = result;

      if (verdict.status === 'REPLACED' && verdict.replacement) {
        return prisma.reference.update({
          where: { id: ref.id },
          data: {
            contentDomain: result.domain,
            verificationStatus: 'REPLACED',
            verificationDetails,
            originalTitle: ref.title,
            title: verdict.replacement.title || ref.title,
            authors: verdict.replacement.authors || ref.authors,
            year: verdict.replacement.year ?? ref.year,
            url: verdict.replacement.url ?? ref.url,
            doi: verdict.replacement.doi ?? ref.doi,
            publisher: verdict.replacement.publisher ?? ref.publisher,
          },
        });
      }

      if (verdict.status === 'VERIFIED') {
        return prisma.reference.update({
          where: { id: ref.id },
          data: {
            contentDomain: result.domain,
            verificationStatus: 'VERIFIED',
            verificationDetails,
          },
        });
      }

      // REMOVED or FAILED → badge FAILED (kept; no renumbering for a class).
      return prisma.reference.update({
        where: { id: ref.id },
        data: {
          contentDomain: result.domain,
          verificationStatus: 'FAILED',
          verificationDetails,
        },
      });
    });

    await Promise.all(updates.filter(Boolean));

    logger.info('Class reference verification complete', {
      episodeId,
      total: String(references.length),
      rejected: String(rejectedRefIds.size),
    });
  } catch (err) {
    // Verification is best-effort — a failure must NOT throw the class.
    logger.warn('Class reference verification failed; references left as-is', {
      episodeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
