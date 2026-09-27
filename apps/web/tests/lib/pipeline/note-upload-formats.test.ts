// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractUploadTexts } from '@/lib/note-upload';

describe('learner note text imports', () => {
  it('preserves plain text and subtitle text as supplied material without AI diarization', async () => {
    const subtitle = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHallo zusammen.';
    const result = await extractUploadTexts([
      new File(['My lesson notes'], 'lesson.txt', { type: 'text/plain' }),
      new File([subtitle], 'lesson.vtt', { type: 'text/vtt' }),
    ]);
    expect(result).toEqual({
      failed: 0,
      texts: [
        'Uploaded course note: lesson.txt\nMy lesson notes',
        `Uploaded course note: lesson.vtt\n${subtitle}`,
      ],
    });
  });
  it('reports unsupported binary subtitle uploads without pretending to parse them', async () => {
    expect(
      await extractUploadTexts([
        new File(['subtitle'], 'lesson.srt', { type: 'application/octet-stream' }),
      ])
    ).toEqual({ texts: [], failed: 1 });
  });
});
