import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReferenceCreateMany } = vi.hoisted(() => ({ mockReferenceCreateMany: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reference: {
      createMany: (...args: unknown[]) => mockReferenceCreateMany(...args),
    },
  },
}));

import { persistGeneratedReferences } from '@/lib/references';
import type { GeneratedReference } from '@/lib/script-generator';

const REF: GeneratedReference = {
  number: 1,
  title: 'A Real Paper',
  authors: ['Ada Lovelace', 'Alan Turing'],
  year: 2021,
  url: 'https://example.org/paper',
  type: 'PAPER',
  publisher: 'Journal of Things',
  doi: '10.1000/xyz',
};

describe('persistGeneratedReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReferenceCreateMany.mockResolvedValue({ count: 1 });
  });

  it('maps all 8 GeneratedReference fields onto Reference rows', async () => {
    await persistGeneratedReferences('episode-1', [REF]);

    expect(mockReferenceCreateMany).toHaveBeenCalledTimes(1);
    expect(mockReferenceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          {
            episodeId: 'episode-1',
            number: 1,
            title: 'A Real Paper',
            authors: ['Ada Lovelace', 'Alan Turing'],
            year: 2021,
            url: 'https://example.org/paper',
            type: 'PAPER',
            publisher: 'Journal of Things',
            doi: '10.1000/xyz',
          },
        ],
      }),
    );
  });

  it('does not call createMany when there are no references', async () => {
    await persistGeneratedReferences('episode-1', []);

    expect(mockReferenceCreateMany).not.toHaveBeenCalled();
  });

  it('persists nullable fields as-is (null year/url/publisher/doi)', async () => {
    const sparse: GeneratedReference = {
      number: 2,
      title: 'No Metadata',
      authors: [],
      year: null,
      url: null,
      type: 'WEB',
      publisher: null,
      doi: null,
    };

    await persistGeneratedReferences('episode-1', [sparse]);

    expect(mockReferenceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            number: 2,
            year: null,
            url: null,
            publisher: null,
            doi: null,
          }),
        ],
      }),
    );
  });
});
