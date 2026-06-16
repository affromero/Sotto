import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockGetOrCreateCurriculum = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      upsert: (...a: unknown[]) => mockUpsert(...a),
    },
  },
}));

vi.mock('@/lib/curriculum-generator', () => ({
  getOrCreateCurriculum: (...a: unknown[]) => mockGetOrCreateCurriculum(...a),
}));

import { createOrRaiseCourse } from '@/lib/placement-course';

describe('createOrRaiseCourse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreateCurriculum.mockResolvedValue({ id: 'cur-1' });
    mockUpsert.mockResolvedValue({ id: 'course-1', currentLevel: 'B1' });
  });

  it('creates a new course at the level and stamps the source', async () => {
    mockFindUnique.mockResolvedValue(null);

    await createOrRaiseCourse('u1', 'en', 'de', 'B1', 'MANUAL');

    expect(mockUpsert.mock.calls[0][0].create).toMatchObject({
      currentLevel: 'B1',
      startLevel: 'B1',
      placementSource: 'MANUAL',
    });
  });

  it('raises an existing course and stamps the source on the raise', async () => {
    mockFindUnique.mockResolvedValue({ currentLevel: 'A2' });

    await createOrRaiseCourse('u1', 'en', 'de', 'B1', 'TEST');

    expect(mockUpsert.mock.calls[0][0].update).toEqual({
      currentLevel: 'B1',
      placementSource: 'TEST',
    });
  });

  it('never lowers and leaves provenance intact when the pick is not higher', async () => {
    mockFindUnique.mockResolvedValue({ currentLevel: 'B2' });

    await createOrRaiseCourse('u1', 'en', 'de', 'A2', 'MANUAL');

    // currentLevel held at B2, and placementSource NOT touched (no real raise).
    expect(mockUpsert.mock.calls[0][0].update).toEqual({ currentLevel: 'B2' });
  });

  it('never rewrites startLevel on update', async () => {
    mockFindUnique.mockResolvedValue({ currentLevel: 'A1' });

    await createOrRaiseCourse('u1', 'en', 'de', 'B1', 'TEST');

    expect(mockUpsert.mock.calls[0][0].update).not.toHaveProperty('startLevel');
  });

  it('omits placementSource when no source is given', async () => {
    mockFindUnique.mockResolvedValue(null);

    await createOrRaiseCourse('u1', 'en', 'de', 'B1');

    expect(mockUpsert.mock.calls[0][0].create).not.toHaveProperty('placementSource');
  });
});
