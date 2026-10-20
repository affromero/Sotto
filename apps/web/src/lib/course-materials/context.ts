import { createHash } from 'node:crypto';
import type { LearningDatabase } from '../learning/database';
import { materialTextInventory, readMaterialTextRange } from './extraction/readers';

const COURSE_CONTEXT_LIMIT = 12000;
type DocumentMetadata = {
  id: string;
  name: string;
  length: number;
  originalUrl: string;
  processingStatus?: string;
  processingRevision?: number;
};
export type CourseSourceFragment = { documentId: string; start: number; end: number; text: string };
type Range = { label: string; start: number; end: number };

function ranges(length: number, allowance: number, seed: string): Range[] {
  if (length <= allowance) return [{ label: 'full', start: 0, end: length }];
  const width = Math.floor(allowance / 3);
  const tailWidth = allowance - width * 2;
  const positions = length - allowance + 1;
  const offset = createHash('sha256').update(seed).digest().readUInt32BE(0) % positions;
  return [
    { label: 'head', start: 0, end: width },
    { label: 'middle', start: width + offset, end: width * 2 + offset },
    { label: 'tail', start: length - tailWidth, end: length },
  ];
}

/** Plan every document's coverage before reading any source ranges from PostgreSQL. */
export function planCourseContext(
  documents: readonly Pick<DocumentMetadata, 'id' | 'name' | 'length'>[],
  seed: string
) {
  if (!documents.length) return [];
  const headers = documents.map(
    (document) =>
      `Document ${JSON.stringify(document.name)} (${document.length} code points). Selected source excerpts, not a complete index.\n`
  );
  const overhead = headers.reduce((sum, header) => sum + header.length + 256, 0);
  const allowance = Math.floor((COURSE_CONTEXT_LIMIT - 2000 - overhead) / (documents.length * 2));
  if (
    documents.some((document) => document.length < 1 || allowance < Math.min(96, document.length))
  )
    throw new Error('Course context cannot cover every document within its supported limit.');
  return documents.map((document, index) => ({
    ...document,
    header: headers[index]!,
    ranges: ranges(document.length, allowance, `${seed}:${document.id}`),
  }));
}

function renderCourseContext(
  planned: ReturnType<typeof planCourseContext>,
  fragments: readonly CourseSourceFragment[]
) {
  const text = planned
    .map((document) =>
      [
        document.header,
        ...document.ranges.map((range) => {
          const fragment = fragments.find(
            (item) =>
              item.documentId === document.id &&
              item.start === range.start &&
              item.end === range.end
          );
          if (!fragment) throw new Error('A planned course source excerpt is unavailable.');
          return `[${range.label}: code points ${range.start}..${range.end}]\n${fragment.text}\n`;
        }),
      ].join('\n')
    )
    .join('\n\n');
  if (text.length > COURSE_CONTEXT_LIMIT)
    throw new Error('Course source context exceeds the supported prompt limit.');
  return { text, fragments };
}

/** Onboarding uses the same bounded source plan while retaining complete originals. */
export function buildCourseSourceContext(
  documents: readonly { id: string; name: string; text: string }[],
  seed: string
) {
  const planned = planCourseContext(
    documents.map((document) => ({
      id: document.id,
      name: document.name,
      length: [...document.text].length,
    })),
    seed
  );
  const fragments = planned.flatMap((document) => {
    const source = [...documents.find((item) => item.id === document.id)!.text];
    return document.ranges.map((range) => ({
      documentId: document.id,
      start: range.start,
      end: range.end,
      text: source.slice(range.start, range.end).join(''),
    }));
  });
  return renderCourseContext(planned, fragments);
}

/** Ownership, metadata and exact ranges stay in the caller's existing transaction. */
export async function readCourseMaterialContext(
  database: LearningDatabase,
  courseId: string,
  userId: string,
  seed: string,
  editableNote = ''
) {
  const materials = await database.$queryRaw<DocumentMetadata[]>`
    SELECT m.id, m.name, m."originalUrl", m."processingStatus", m."processingRevision",
      char_length(m."extractedText")::int AS length
    FROM "CourseMaterial" m
    JOIN "Course" c ON c.id = m."courseId" AND c."userId" = m."userId"
    WHERE m."courseId" = ${courseId} AND m."userId" = ${userId}
      AND m."originalUrl" IS NOT NULL
    ORDER BY m."createdAt", m.id
  `;
  const inventories = new Map<string, Awaited<ReturnType<typeof materialTextInventory>>>();
  for (const material of materials) {
    if (!material.processingStatus || material.processingStatus === 'LEGACY') continue;
    if (!material.processingRevision)
      throw new Error('Material processing identity is unavailable.');
    const inventory = await materialTextInventory(database, {
      materialId: material.id,
      userId,
      processingRevision: material.processingRevision,
    });
    material.length = inventory.length;
    inventories.set(material.id, inventory);
  }
  if (!materials.length && editableNote.length <= COURSE_CONTEXT_LIMIT - 2000)
    return { text: editableNote, fragments: [], materials };
  const noteId = 'editable-course-note';
  const documents = [
    ...(editableNote
      ? [{ id: noteId, name: 'Editable course note', length: [...editableNote].length }]
      : []),
    ...materials,
  ];
  const planned = planCourseContext(documents, seed);
  const fragments: CourseSourceFragment[] = [];
  for (const document of planned) {
    for (const range of document.ranges) {
      let text: string;
      if (document.id === noteId) text = [...editableNote].slice(range.start, range.end).join('');
      else {
        const material = materials.find((item) => item.id === document.id)!;
        const inventory = inventories.get(material.id);
        if (inventory) {
          text = await readMaterialTextRange(database, inventory, range.start, range.end);
          fragments.push({ documentId: document.id, start: range.start, end: range.end, text });
          continue;
        }
        const rows = await database.$queryRaw<Array<{ text: string }>>`
          SELECT substring("extractedText", ${range.start + 1}::int, ${range.end - range.start}::int) AS text
          FROM "CourseMaterial"
          WHERE id = ${document.id} AND "courseId" = ${courseId} AND "userId" = ${userId}
            AND "originalUrl" = ${material.originalUrl}
        `;
        if (rows.length !== 1 || !rows[0]!.text)
          throw new Error('An owned course document changed while selecting its source excerpts.');
        text = rows[0]!.text;
      }
      fragments.push({ documentId: document.id, start: range.start, end: range.end, text });
    }
  }
  return { ...renderCourseContext(planned, fragments), materials };
}
