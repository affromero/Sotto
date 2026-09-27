import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const boundary = vi.hoisted(() => ({
  authenticate: vi.fn(),
  course: vi.fn(),
  admit: vi.fn(),
  activity: vi.fn(),
  recover: vi.fn(),
}));
vi.mock('@/lib/api-keys', () => ({ authenticateRequest: boundary.authenticate }));
vi.mock('@/lib/prisma', () => ({ prisma: { course: { findFirst: boundary.course } } }));
vi.mock('@/lib/classes/preparation', () => ({
  requestClassPreparation: boundary.admit,
  readPreparationActivity: boundary.activity,
  recoverClassPreparation: boundary.recover,
}));

import { GET, PATCH, POST } from '@/app/api/v1/courses/[courseId]/preparation/route';
import { PreparationConflictError } from '@/lib/classes/preparation-state';

const schedule = {
  availableAt: '2026-09-28T08:00:00-05:00',
  timeZone: 'America/Bogota',
  maxProviderRequests: 20,
  deferAudio: true,
};
function post(body: unknown = schedule) {
  return POST(
    new NextRequest('http://localhost/api/v1/courses/course-1/preparation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ courseId: 'course-1' }) }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.authenticate.mockResolvedValue({ userId: 'learner-1' });
  boundary.course.mockResolvedValue({ id: 'course-1' });
  boundary.admit.mockResolvedValue({
    id: 'operation-1',
    status: 'QUEUED',
    availableAt: Date.parse(schedule.availableAt),
    timeZone: schedule.timeZone,
    maxProviderRequests: 20,
    deferAudio: true,
    selection: { credentialFingerprint: 'private-credential-binding' },
    grant: { revision: 'private-grant-binding' },
  });
});

describe('class preparation recovery', () => {
  function recover(body: unknown = { acknowledgeUnknownOutcome: true }) {
    return PATCH(
      new NextRequest('http://localhost/api/v1/courses/course-1/preparation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ courseId: 'course-1' }) }
    );
  }
  it('requires authentication', async () => {
    boundary.authenticate.mockResolvedValue(null);
    expect((await recover()).status).toBe(401);
  });
  it.each([
    {},
    null,
    { acknowledgeUnknownOutcome: false },
    { acknowledgeUnknownOutcome: true, force: true },
  ])('requires explicit acknowledgement without expanded authority: %j', async (body) => {
    expect((await recover(body)).status).toBe(400);
  });
  it('returns only the recovered operation identity and status', async () => {
    boundary.recover.mockResolvedValue({
      id: 'operation-1',
      status: 'CANCELLED',
      grant: 'private',
    });
    const response = await recover();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ operationId: 'operation-1', status: 'CANCELLED' });
  });
  it('preserves conflicts when physical cleanup remains unconfirmed', async () => {
    boundary.recover.mockRejectedValue(new PreparationConflictError('Cleanup is not confirmed.'));
    const response = await recover();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Cleanup is not confirmed.' });
  });
  it('sanitizes unexpected recovery failures', async () => {
    boundary.recover.mockRejectedValue(new Error('private database detail'));
    const response = await recover();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Could not recover preparation.' });
  });
});

describe('scheduled class preparation admission', () => {
  it('requires authentication', async () => {
    boundary.authenticate.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });
  it('hides courses belonging to another learner', async () => {
    boundary.course.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(boundary.course).toHaveBeenCalledWith({
      where: { id: 'course-1', userId: 'learner-1' },
      select: { id: true },
    });
  });
  it('returns only durable public scheduling fields after admission succeeds', async () => {
    const response = await post();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      operationId: 'operation-1',
      status: 'QUEUED',
      availableAt: '2026-09-28T13:00:00.000Z',
      timeZone: 'America/Bogota',
      maxProviderRequests: 20,
      deferAudio: true,
    });
  });
  it.each([
    { ...schedule, availableAt: 'tomorrow' },
    { ...schedule, availableAt: '2026-09-28T08:00:00' },
    { ...schedule, timeZone: 'not-a-timezone' },
    { ...schedule, maxProviderRequests: 0 },
    { ...schedule, maxProviderRequests: 257 },
    { ...schedule, maxProviderRequests: 1.5 },
    { ...schedule, deferAudio: false },
    { ...schedule, credential: 'untrusted-override' },
    {},
    null,
  ])('rejects invalid or expanded task authority: %j', async (body) => {
    expect((await post(body)).status).toBe(400);
  });
  it('returns an actionable conflict when existing work prevents admission', async () => {
    boundary.admit.mockRejectedValue(new PreparationConflictError('Recovery is required.'));
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Recovery is required.' });
  });
  it('does not acknowledge failed persistence or publish its error text', async () => {
    boundary.admit.mockRejectedValue(new Error('private credential or database detail'));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Could not schedule class preparation.' });
  });
});

describe('preparation activity', () => {
  const get = (query = '') =>
    GET(new NextRequest(`http://localhost/api/v1/courses/course-1/preparation${query}`), {
      params: Promise.resolve({ courseId: 'course-1' }),
    });
  it('requires authentication', async () => {
    boundary.authenticate.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
  it('hides absent or inaccessible preparation', async () => {
    boundary.activity.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });
  it('returns the persisted bounded activity page', async () => {
    const page = {
      operationId: 'operation-1',
      events: [{ sequence: 2, type: 'started' }],
      cursor: 2,
    };
    boundary.activity.mockResolvedValue(page);
    const response = await get('?after=1&limit=20');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
  });
  it.each(['?after=-1', '?after=1.5', '?limit=0', '?limit=101', '?limit=no'])(
    'rejects invalid pagination %s',
    async (query) => {
      expect((await get(query)).status).toBe(400);
    }
  );
  it('surfaces authority conflicts', async () => {
    boundary.activity.mockRejectedValue(new PreparationConflictError('The learner changed.'));
    const response = await get();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'The learner changed.' });
  });
  it('sanitizes storage failures', async () => {
    boundary.activity.mockRejectedValue(new Error('private credentials'));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Could not read preparation activity.' });
  });
});
