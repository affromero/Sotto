import type { Prisma } from '@/generated/prisma/client';

/** Fixed application fields shared by storage inventory and pre-cascade retirement. */
export const storageConsumerFields = [
  ['Episode', 'audioUrl', 'episode', 'audio', 'episode'],
  ['Episode', 'pdfUrl', 'episode', 'transcript', 'episode'],
  ['Episode', 'waveformUrl', 'episode', 'waveform', 'episode'],
  ['Episode', 'spectrogramUrl', 'episode', 'spectrogram', 'episode'],
  ['Segment', 'audioUrl', 'segment', 'audio', 'segment'],
  ['EpisodeVersion', 'audioUrl', 'episode-version', 'audio', 'version'],
  ['SpeakingRecording', 'audioUrl', 'recording', 'audio', 'recording'],
  ['SpeakingPrompt', 'referenceTtsUrl', 'speaking-prompt', 'reference', 'prompt'],
  ['LearnerFocusTarget', 'pronunciationAudioUrl', 'focus-target', 'pronunciation', 'focus'],
  ['LearnerFocusTarget', 'visualCueUrl', 'focus-target', 'visual', 'focus'],
  ['CourseClass', 'worksheetPdfUrl', 'class', 'worksheet', 'class'],
  ['User', 'image', 'profile', 'avatar', 'user'],
] as const;

export function consumerForStorageField(source: string, id: string, field: string): string | null {
  const mapping = storageConsumerFields.find((value) => value[4] === source && value[1] === field);
  return mapping ? `${mapping[2]}:${id}:${mapping[3]}` : null;
}

function consumerField(consumer: string) {
  const parts = consumer.split(':');
  if (parts.length !== 3 || !parts[1]) throw new Error('Invalid storage consumer');
  const mapping = storageConsumerFields.find(
    (value) => value[2] === parts[0] && value[3] === parts[2]
  );
  if (!mapping) throw new Error('Unsupported storage consumer');
  return { model: mapping[0], field: mapping[1], id: parts[1] };
}

export async function readStorageConsumerReference(
  database: Prisma.TransactionClient,
  consumer: string
) {
  const { model, field, id } = consumerField(consumer);
  const rows = await database.$queryRawUnsafe<Array<{ reference: string | null }>>(
    `SELECT "${field}" AS reference FROM "${model}" WHERE id = $1`,
    id
  );
  return rows[0]?.reference ?? null;
}

/** Identifiers come only from the fixed mapping. Call inside the reference publication transaction. */
export async function replaceStorageConsumerReference(
  database: Prisma.TransactionClient,
  consumer: string,
  previous: string,
  next: string
) {
  const { model, field, id } = consumerField(consumer);
  const rows = await database.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "${model}" SET "${field}" = $1 WHERE id = $2 AND "${field}" = $3 RETURNING id`,
    next,
    id,
    previous
  );
  if (rows.length !== 1) throw new Error('Storage consumer changed during publication');
}
