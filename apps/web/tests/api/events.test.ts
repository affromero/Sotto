import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockAuth = vi.fn();
const mockAuthenticateRequest = vi.fn();
const mockAddJob = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/queue', () => ({
  eventIngestionQueue: {},
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { INGEST_EVENTS: 'INGEST_EVENTS' },
}));

// ── Import route AFTER mocks ──────────────────────────────────────────

import { POST } from '@/app/api/v1/events/route';

// ── Helpers ───────────────────────────────────────────────────────────

function createRequest(body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/v1/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function validEvent(overrides?: Record<string, unknown>) {
  return {
    context: {
      sessionId: 'sess-123',
      userId: undefined as string | undefined,
      pageUrl: '/podcast/abc',
      clientTs: Date.now(),
      deviceType: 'mobile' as const,
    },
    payload: {
      eventType: 'playback.play',
      podcastId: 'pod-1',
      position: 42,
      speed: 1,
    },
    ...overrides,
  };
}

function validBatch(events = [validEvent()]) {
  return { events };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('POST /api/v1/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue(null);
    mockAddJob.mockResolvedValue(undefined);
  });

  // ── Validation ────────────────────────────────────────────────────

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest(new URL('http://localhost:3000/api/v1/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid JSON/i);
  });

  it('returns 400 for invalid event batch (empty events array)', async () => {
    const res = await POST(createRequest({ events: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid event batch/i);
  });

  it('returns 400 for missing required fields in event payload', async () => {
    const res = await POST(
      createRequest({
        events: [{ context: { sessionId: 'x' }, payload: {} }],
      })
    );
    expect(res.status).toBe(400);
  });

  it('accepts private library analytics events', async () => {
    const res = await POST(
      createRequest(
        validBatch([
          validEvent({
            payload: {
              eventType: 'library.search',
              query: 'agent briefings',
              resultCount: 4,
              filters: { source: 'saved' },
            },
          }),
        ])
      )
    );

    expect(res.status).toBe(202);
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].payload.eventType).toBe('library.search');
  });

  it.each(['feed.search', 'feed.click', 'social.like', 'social.follow', 'social.fork'])(
    'rejects legacy public event type %s',
    async (eventType) => {
      const res = await POST(
        createRequest(
          validBatch([
            validEvent({
              payload: {
                eventType,
                podcastId: 'pod-1',
                query: 'legacy',
                resultCount: 1,
                position: 0,
                targetUserId: 'user-2',
                dwellTimeMs: 1,
              },
            }),
          ])
        )
      );

      expect(res.status).toBe(400);
    }
  );

  // ── Anonymous events ──────────────────────────────────────────────

  it('accepts anonymous events (no auth) and returns 202', async () => {
    const res = await POST(createRequest(validBatch()));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.accepted).toBe(1);
    expect(mockAddJob).toHaveBeenCalledOnce();
  });

  it('queues events with no userId when unauthenticated', async () => {
    await POST(createRequest(validBatch()));
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBeUndefined();
  });

  // ── NextAuth session auth ─────────────────────────────────────────

  it('attaches userId from NextAuth session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'session-user-1' } });
    await POST(createRequest(validBatch()));
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBe('session-user-1');
  });

  it('does not try Bearer auth when session auth succeeds', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'session-user-1' } });
    await POST(createRequest(validBatch()));
    expect(mockAuthenticateRequest).not.toHaveBeenCalled();
  });

  // ── Bearer token auth (mobile) ───────────────────────────────────

  it('falls back to Bearer token when session returns no user', async () => {
    mockAuth.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue({ userId: 'mobile-user-1' });

    const res = await POST(createRequest(validBatch()));
    expect(res.status).toBe(202);
    expect(mockAuthenticateRequest).toHaveBeenCalledOnce();
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBe('mobile-user-1');
  });

  it('falls back to Bearer token when session throws', async () => {
    mockAuth.mockRejectedValue(new Error('session error'));
    mockAuthenticateRequest.mockResolvedValue({ userId: 'mobile-user-2' });

    const res = await POST(createRequest(validBatch()));
    expect(res.status).toBe(202);
    expect(mockAuthenticateRequest).toHaveBeenCalledOnce();
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBe('mobile-user-2');
  });

  it('still accepts events when both auth methods fail', async () => {
    mockAuth.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue(null);

    const res = await POST(createRequest(validBatch()));
    expect(res.status).toBe(202);
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBeUndefined();
  });

  it('still accepts events when Bearer auth throws', async () => {
    mockAuth.mockResolvedValue(null);
    mockAuthenticateRequest.mockRejectedValue(new Error('key error'));

    const res = await POST(createRequest(validBatch()));
    expect(res.status).toBe(202);
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBeUndefined();
  });

  // ── Client userId vs server userId ────────────────────────────────

  it('prefers client-provided userId over server userId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'server-user' } });
    const event = validEvent();
    event.context.userId = 'client-user';

    await POST(createRequest(validBatch([event])));
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBe('client-user');
  });

  it('fills in server userId when client userId is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'server-user' } });

    await POST(createRequest(validBatch()));
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.events[0].context.userId).toBe('server-user');
  });

  // ── IP extraction ─────────────────────────────────────────────────

  it('extracts IP from x-forwarded-for header', async () => {
    const req = createRequest(validBatch(), {
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });
    await POST(req);
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.ip).toBe('1.2.3.4');
  });

  it('extracts IP from x-real-ip header when no x-forwarded-for', async () => {
    const req = createRequest(validBatch(), {
      'x-real-ip': '9.8.7.6',
    });
    await POST(req);
    const payload = mockAddJob.mock.calls[0][2];
    expect(payload.ip).toBe('9.8.7.6');
  });

  // ── Batch processing ──────────────────────────────────────────────

  it('accepts multiple events in a single batch', async () => {
    const events = [
      validEvent(),
      {
        context: {
          sessionId: 'sess-456',
          pageUrl: '/dashboard',
          clientTs: Date.now(),
        },
        payload: {
          eventType: 'page.view' as const,
          path: '/dashboard',
        },
      },
    ];
    const res = await POST(createRequest({ events }));
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.accepted).toBe(2);
  });

  // ── Job queuing ───────────────────────────────────────────────────

  it('queues INGEST_EVENTS job with correct payload shape', async () => {
    await POST(createRequest(validBatch()));
    expect(mockAddJob).toHaveBeenCalledWith(
      {},
      'INGEST_EVENTS',
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            context: expect.objectContaining({ sessionId: 'sess-123' }),
            payload: expect.objectContaining({ eventType: 'playback.play' }),
          }),
        ]),
      })
    );
  });
});
