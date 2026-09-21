// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { processAudioStitching } from '@/workers/audio-stitching.worker';

describe('audio stitching contract boundary', () => {
  it.each(['stitch_audio', 'audio-stitching.v3'])(
    'rejects unsupported %s work before processing',
    async (name) => {
      await expect(
        processAudioStitching({
          id: 'unsupported',
          name,
          data: { episodeId: 'old-episode', segmentIds: ['old-segment'] },
          updateProgress: async () => {
            throw new Error('Unsupported work reported progress');
          },
        })
      ).rejects.toThrow('Audio stitching requires a canonical Sidedoor job reference');
    }
  );
});
