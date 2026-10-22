import { dictionaryQuerySchema, dictionaryWordSchema } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '../prisma';
import {
  introducedVocabularyWhere,
  unseenVocabularyWhere,
  isVocabularyIntroduced,
} from '../learning/vocabulary/memory';
import { VocabularyStudyNotFound } from './study-state';
import { sourceTextHash } from './index-state';
import { reconcileVocabularyIndex } from './index-reconciliation';
import { sottoTransaction } from '../sidedoor/access/state/transaction';
import { prismaUnfiltered } from '../prisma';
import { canonicalVocabularySourceSchema } from './source/snapshot';
import { decodeVocabularySourceQuote } from './source/publication';

export async function readDictionary(courseId: string, userId: string, input: unknown) {
  const query = dictionaryQuerySchema.parse(input);
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
    select: { id: true, vocabularySupport: true, nativeLang: true, targetLang: true },
  });
  if (!course) throw new VocabularyStudyNotFound('Course not found.');
  const running = await prisma.materialVocabularyIndex.findMany({
    where: { courseId, status: 'ACTIVE' },
    select: { id: true },
  });
  for (const index of running)
    await sottoTransaction(prismaUnfiltered, (database) =>
      reconcileVocabularyIndex(database, index.id, userId)
    );
  const now = new Date();
  const introduced = introducedVocabularyWhere();
  const filters: Prisma.LearnerVocabWhereInput[] = [{ courseId }];
  if (query.search)
    filters.push({
      OR: [
        { lemma: { contains: query.search, mode: 'insensitive' } },
        { translation: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  if (query.state === 'unseen') filters.push(unseenVocabularyWhere());
  if (query.state === 'due')
    filters.push(introduced, { lastReviewed: { not: null }, dueAt: { lte: now } });
  if (query.state === 'strong') filters.push({ mastery: { gte: 0.85 } });
  if (query.state === 'learning') filters.push(introduced, { mastery: { lt: 0.85 } });
  const where = { AND: filters };
  const [rows, total, unseen, due, strong, materials] = await Promise.all([
    prisma.learnerVocab.findMany({
      where,
      orderBy: [{ lemma: 'asc' }, { id: 'asc' }],
      take: 40,
      skip: (query.page - 1) * 40,
      include: {
        sources: {
          select: {
            materialId: true,
            startOffset: true,
            endOffset: true,
            quote: true,
            quoteBytes: true,
            meaning: true,
            material: { select: { name: true } },
            chunk: { select: { index: { select: { protocol: true } } } },
          },
          orderBy: { startOffset: 'asc' },
          take: 10,
        },
        _count: { select: { sources: true, reviewEvents: true } },
      },
    }),
    prisma.learnerVocab.count({ where }),
    prisma.learnerVocab.count({ where: { courseId, ...unseenVocabularyWhere() } }),
    prisma.learnerVocab.count({
      where: { courseId, AND: [introduced, { lastReviewed: { not: null }, dueAt: { lte: now } }] },
    }),
    prisma.learnerVocab.count({ where: { courseId, mastery: { gte: 0.85 } } }),
    prisma.courseMaterial.findMany({
      where: { courseId, userId, originalUrl: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        extractedText: true,
        originalUrl: true,
        originalSha256: true,
        processingRevision: true,
        processingStatus: true,
        createdAt: true,
        vocabularyIndexes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            chunks: {
              where: { status: { not: 'SPLIT' } },
              select: { status: true, _count: { select: { sources: true } } },
            },
          },
        },
      },
    }),
  ]);
  return {
    words: rows.map((word) =>
      dictionaryWordSchema.parse({
        ...word,
        reviews: word._count.reviewEvents,
        state: !isVocabularyIntroduced(word)
          ? 'unseen'
          : !word.lastReviewed
            ? 'introduced'
            : word.dueAt <= now
              ? 'due'
              : word.mastery >= 0.85
                ? 'strong'
                : 'learning',
        dueAt: word.lastReviewed ? word.dueAt.toISOString() : null,
        lastReviewed: word.lastReviewed?.toISOString() ?? null,
        sourceCount: word._count.sources,
        sources: word.sources.map((source) => ({
          materialId: source.materialId,
          startOffset: source.startOffset,
          endOffset: source.endOffset,
          meaning: source.meaning,
          quote: decodeVocabularySourceQuote(source),
          coordinateSystem: source.chunk.index.protocol === 2 ? 'MATERIAL_CODEPOINTS' : 'UTF16',
          name: source.material.name,
        })),
      })
    ),
    total,
    page: query.page,
    pages: Math.max(1, Math.ceil(total / 40)),
    counts: { unseen, due, strong },
    vocabularySupport: course.vocabularySupport,
    materials: materials.map((material) => {
      const index = material.vocabularyIndexes[0];
      const snapshot =
        index?.protocol === 2 ? canonicalVocabularySourceSchema.parse(index.sourceSnapshot) : null;
      const current =
        index &&
        index.nativeLang === course.nativeLang &&
        index.targetLang === course.targetLang &&
        (snapshot
          ? snapshot.materialGeneration === material.createdAt.getTime() &&
            snapshot.processingRevision === material.processingRevision &&
            snapshot.inventory.originalSha256 === material.originalSha256
          : index.textHash === sourceTextHash(material.extractedText));
      return {
        id: material.id,
        name: material.name,
        status: current
          ? index.status
          : ['QUEUED', 'EXTRACTING'].includes(material.processingStatus)
            ? 'PENDING'
            : 'NOT_INDEXED',
        error: index?.error ?? null,
        processedChunks: index?.chunks.filter((chunk) => chunk.status === 'COMPLETE').length ?? 0,
        totalChunks: index?.chunks.length ?? 0,
        entries: index?.chunks.reduce((sum, chunk) => sum + chunk._count.sources, 0) ?? 0,
      };
    }),
  };
}
