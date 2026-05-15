// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { diarizeSpeakers } from '@/lib/transcript-parser';

describe('diarizeSpeakers', () => {
  it('requires an explicit AI provider and model', async () => {
    await expect(
      diarizeSpeakers([{ start: 0, end: 1, text: 'Hello from the transcript.' }])
    ).rejects.toThrow('AI provider and model are required for speaker diarization.');
  });
});
