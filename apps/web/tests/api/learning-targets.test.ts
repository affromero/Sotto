import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  LearningTargetCourseNotFoundError,
  LearningTargetNotFoundError,
  LearningTargetUnavailableError,
} = vi.hoisted(() => {
  class LearningTargetCourseNotFoundError extends Error {}
  class LearningTargetNotFoundError extends Error {}
  class LearningTargetUnavailableError extends Error {}
  return {
    LearningTargetCourseNotFoundError,
    LearningTargetNotFoundError,
    LearningTargetUnavailableError,
  };
});

const mockAuthenticateRequest = vi.fn();
const mockAddLearningTarget = vi.fn();
const mockListLearningTargets = vi.fn();
const mockAddVisualCue = vi.fn();
const mockGenerateTargetPronunciation = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/learning-targets', () => ({
  addLearningTarget: (...a: unknown[]) => mockAddLearningTarget(...a),
  listLearningTargets: (...a: unknown[]) => mockListLearningTargets(...a),
  addVisualCue: (...a: unknown[]) => mockAddVisualCue(...a),
  generateTargetPronunciation: (...a: unknown[]) => mockGenerateTargetPronunciation(...a),
  LearningTargetCourseNotFoundError,
  LearningTargetNotFoundError,
  LearningTargetUnavailableError,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  GET as listGet,
  POST as addPost,
} from '@/app/api/v1/courses/[courseId]/learning-targets/route';
import { POST as visualPost } from '@/app/api/v1/courses/[courseId]/learning-targets/[targetId]/visual-cue/route';
import { POST as pronunciationPost } from '@/app/api/v1/courses/[courseId]/learning-targets/[targetId]/pronunciation/route';

const COURSE_PARAMS = { params: Promise.resolve({ courseId: 'c1' }) };
const TARGET_PARAMS = { params: Promise.resolve({ courseId: 'c1', targetId: 'ft1' }) };

const TARGET = {
  id: 'ft1',
  courseId: 'c1',
  kind: 'SENTENCE',
  text: 'Me cuesta entenderlo.',
  normalizedText: 'me cuesta entenderlo.',
  contextText: null,
  sourceType: 'CLASS',
  sourceId: 'section-1',
  sourceLabel: 'Reading',
  userMarkedDifficulty: 4,
  priorityBoost: 0.47,
  visualCueUrl: null,
  visualCueAlt: null,
  visualCueAttribution: null,
  visualCueProvider: null,
  pronunciationAudioUrl: null,
  lastSelectedAt: '2026-06-15T00:00:00.000Z',
  lastPracticedAt: null,
};

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'u1' });
});

describe('GET /api/v1/courses/[courseId]/learning-targets', () => {
  it('lists targets for the authenticated course owner', async () => {
    mockListLearningTargets.mockResolvedValue([TARGET]);

    const res = await listGet(
      new NextRequest('http://localhost/api/v1/courses/c1/learning-targets?limit=10'),
      COURSE_PARAMS,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ targets: [TARGET] });
    expect(mockListLearningTargets).toHaveBeenCalledWith('c1', 'u1', 10);
  });
});

describe('POST /api/v1/courses/[courseId]/learning-targets', () => {
  it('adds a learner-marked target', async () => {
    mockAddLearningTarget.mockResolvedValue(TARGET);

    const res = await addPost(
      jsonReq('http://localhost/api/v1/courses/c1/learning-targets', {
        text: 'Me cuesta entenderlo.',
        sourceType: 'CLASS',
        userMarkedDifficulty: 4,
      }),
      COURSE_PARAMS,
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(TARGET);
    expect(mockAddLearningTarget).toHaveBeenCalledWith(
      'c1',
      'u1',
      expect.objectContaining({ text: 'Me cuesta entenderlo.', sourceType: 'CLASS' }),
    );
  });

  it('400s on malformed target data', async () => {
    const res = await addPost(
      jsonReq('http://localhost/api/v1/courses/c1/learning-targets', { text: '' }),
      COURSE_PARAMS,
    );

    expect(res.status).toBe(400);
    expect(mockAddLearningTarget).not.toHaveBeenCalled();
  });
});

describe('learning-target enhancement routes', () => {
  it('adds a visual cue when the provider is configured', async () => {
    mockAddVisualCue.mockResolvedValue({ ...TARGET, visualCueUrl: 'https://images.pexels.com/a.jpg' });

    const res = await visualPost(
      new NextRequest('http://localhost/api/v1/courses/c1/learning-targets/ft1/visual-cue', {
        method: 'POST',
      }),
      TARGET_PARAMS,
    );

    expect(res.status).toBe(200);
    expect(mockAddVisualCue).toHaveBeenCalledWith('c1', 'u1', 'ft1');
  });

  it('returns 422 when pronunciation cannot be generated', async () => {
    mockGenerateTargetPronunciation.mockRejectedValue(
      new LearningTargetUnavailableError('No TTS provider is configured'),
    );

    const res = await pronunciationPost(
      new NextRequest('http://localhost/api/v1/courses/c1/learning-targets/ft1/pronunciation', {
        method: 'POST',
      }),
      TARGET_PARAMS,
    );

    expect(res.status).toBe(422);
  });
});
