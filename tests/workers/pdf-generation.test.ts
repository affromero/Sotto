import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    podcast: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock PDF generator
vi.mock('@/lib/pdf-generator', () => ({
  generatePodcastPdf: vi.fn(),
}));

// Mock R2
vi.mock('@/lib/r2', () => ({
  uploadFile: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { processPdfGeneration } from '@/workers/pdf-generation.worker';
import { prisma } from '@/lib/prisma';
import { generatePodcastPdf } from '@/lib/pdf-generator';
import { uploadFile } from '@/lib/r2';

const mockPodcast = {
  id: 'pod-1',
  title: 'Test Podcast',
  topic: 'Testing',
  createdAt: new Date('2024-01-01'),
  user: { name: 'Test User' },
  segments: [
    { speaker: 'HOST', text: 'Hello!' },
    { speaker: 'EXPERT', text: 'Welcome [1].' },
  ],
  references: [
    {
      id: 'ref-1',
      number: 1,
      title: 'Test Reference',
      authors: ['Author A'],
      year: 2023,
      url: 'https://example.com',
      type: 'PAPER',
      publisher: 'Nature',
      doi: null,
    },
  ],
};

function createMockJob(data: { podcastId: string; userId: string }) {
  return {
    data,
    updateProgress: vi.fn(),
  } as unknown as Parameters<typeof processPdfGeneration>[0];
}

describe('pdf-generation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.podcast.findUniqueOrThrow).mockResolvedValue(mockPodcast as never);
    vi.mocked(generatePodcastPdf).mockResolvedValue(Buffer.from('fake-pdf'));
    vi.mocked(uploadFile).mockResolvedValue('https://r2.example.com/podcasts/pod-1/transcript.pdf');
    vi.mocked(prisma.podcast.update).mockResolvedValue({} as never);
  });

  it('loads podcast with segments and references', async () => {
    const job = createMockJob({ podcastId: 'pod-1', userId: 'user-1' });
    await processPdfGeneration(job);

    expect(prisma.podcast.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      include: expect.objectContaining({
        user: expect.any(Object),
        segments: expect.any(Object),
        references: expect.any(Object),
      }),
    });
  });

  it('generates a PDF with the correct data', async () => {
    const job = createMockJob({ podcastId: 'pod-1', userId: 'user-1' });
    await processPdfGeneration(job);

    expect(generatePodcastPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Podcast',
        topic: 'Testing',
        creatorName: 'Test User',
        segments: mockPodcast.segments,
      })
    );
  });

  it('uploads the PDF to R2', async () => {
    const job = createMockJob({ podcastId: 'pod-1', userId: 'user-1' });
    await processPdfGeneration(job);

    expect(uploadFile).toHaveBeenCalledWith(
      'podcasts/pod-1/transcript.pdf',
      Buffer.from('fake-pdf'),
      'application/pdf'
    );
  });

  it('updates the podcast pdfUrl in the database', async () => {
    const job = createMockJob({ podcastId: 'pod-1', userId: 'user-1' });
    await processPdfGeneration(job);

    expect(prisma.podcast.update).toHaveBeenCalledWith({
      where: { id: 'pod-1' },
      data: { pdfUrl: 'https://r2.example.com/podcasts/pod-1/transcript.pdf' },
    });
  });

  it('updates progress throughout the process', async () => {
    const job = createMockJob({ podcastId: 'pod-1', userId: 'user-1' });
    await processPdfGeneration(job);

    expect(job.updateProgress).toHaveBeenCalledWith(10);
    expect(job.updateProgress).toHaveBeenCalledWith(30);
    expect(job.updateProgress).toHaveBeenCalledWith(70);
    expect(job.updateProgress).toHaveBeenCalledWith(90);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it('uses "Anonymous" when creator name is null', async () => {
    vi.mocked(prisma.podcast.findUniqueOrThrow).mockResolvedValue({
      ...mockPodcast,
      user: { name: null },
    } as never);

    const job = createMockJob({ podcastId: 'pod-1', userId: 'user-1' });
    await processPdfGeneration(job);

    expect(generatePodcastPdf).toHaveBeenCalledWith(
      expect.objectContaining({ creatorName: 'Anonymous' })
    );
  });
});
