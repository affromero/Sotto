// @vitest-environment node
import type { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { processWaveformGeneration } from '@/workers/waveform-generation.worker';

describe('waveform worker contract', () => {
  it.each(['generate_waveform', 'waveform-generation.v2', 'waveform-generation.v01'])(
    'rejects unsupported %s work before accessing storage or episode data',
    async (name) => {
      await expect(
        processWaveformGeneration({ name, data: { episodeId: 'old-episode' } } as Job<unknown>)
      ).rejects.toThrow('requires a canonical Sidedoor job reference');
    }
  );
});
