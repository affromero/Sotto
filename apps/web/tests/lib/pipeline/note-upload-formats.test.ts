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
    expect(result).toMatchObject({
      failed: 0,
      texts: [
        'Uploaded course note: lesson.txt\nMy lesson notes',
        `Uploaded course note: lesson.vtt\n${subtitle}`,
      ],
    });
    expect(result.uploads.map((upload) => upload.file.name)).toEqual(['lesson.txt', 'lesson.vtt']);
    expect(await result.uploads[1]!.file.text()).toBe(subtitle);
  });
  it('reports unsupported binary subtitle uploads without pretending to parse them', async () => {
    expect(
      await extractUploadTexts([
        new File(['subtitle'], 'lesson.srt', { type: 'application/octet-stream' }),
      ])
    ).toEqual({ texts: [], uploads: [], failed: 1 });
  });
  it('keeps successful filenames aligned with their extracts after an earlier file fails', async () => {
    const result = await extractUploadTexts([
      new File(['binary'], 'bad.bin'),
      new File(['Hallo'], 'good.txt', { type: 'text/plain' }),
    ]);
    expect(result.failed).toBe(1);
    expect(result.uploads).toHaveLength(1);
    expect(result.uploads[0]!.file.name).toBe('good.txt');
    expect(result.uploads[0]!.text).toContain('good.txt');
    expect(result.uploads[0]!.text).toContain('Hallo');
  });
});
