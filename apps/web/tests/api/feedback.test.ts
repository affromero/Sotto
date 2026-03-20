import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockFeedbackCreate = vi.fn();
const mockFeedbackFindMany = vi.fn();

const mockAuth = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    feedback: {
      create: (...args: unknown[]) => mockFeedbackCreate(...args),
      findMany: (...args: unknown[]) => mockFeedbackFindMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4 }),
}));

import { POST, GET } from '@/app/api/feedback/route';

const mockPrisma = {
  feedback: {
    create: mockFeedbackCreate,
    findMany: mockFeedbackFindMany,
  },
};

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}


const validFeedback = {
  type: 'GENERAL',
  subject: 'Great product',
  message: 'I really love using Sotto for learning new topics.',
};

describe('POST /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates feedback with valid required fields', async () => {
    mockPrisma.feedback.create.mockResolvedValue({
      id: 'fb-1',
      type: 'GENERAL',
      subject: 'Great product',
      message: 'I really love using Sotto for learning new topics.',
      email: null,
      name: null,
      rating: null,
      context: null,
      userId: null,
      status: 'NEW',
      response: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createPostRequest(validFeedback);
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('fb-1');
    expect(body.message).toBe('Thank you for your feedback!');
  });

  it('creates feedback with optional name field', async () => {
    mockPrisma.feedback.create.mockResolvedValue({
      id: 'fb-3',
      type: 'PRAISE',
      subject: 'Wonderful',
      message: 'Incredible tool!',
      email: null,
      name: 'Alice',
      rating: null,
      context: null,
      userId: null,
      status: 'NEW',
      response: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createPostRequest({
      ...validFeedback,
      type: 'PRAISE',
      subject: 'Wonderful',
      message: 'Incredible tool!',
      name: 'Alice',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('creates feedback with optional email field', async () => {
    mockPrisma.feedback.create.mockResolvedValue({
      id: 'fb-4',
      type: 'FEATURE_REQUEST',
      subject: 'More voices',
      message: 'Please add more voice options.',
      email: 'alice@example.com',
      name: null,
      rating: null,
      context: null,
      userId: null,
      status: 'NEW',
      response: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createPostRequest({
      ...validFeedback,
      type: 'FEATURE_REQUEST',
      subject: 'More voices',
      message: 'Please add more voice options.',
      email: 'alice@example.com',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('creates feedback with optional rating field', async () => {
    mockPrisma.feedback.create.mockResolvedValue({
      id: 'fb-5',
      type: 'GENERAL',
      subject: 'Good experience',
      message: 'Had a solid first experience.',
      email: null,
      name: null,
      rating: 4,
      context: null,
      userId: null,
      status: 'NEW',
      response: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createPostRequest({
      ...validFeedback,
      subject: 'Good experience',
      message: 'Had a solid first experience.',
      rating: 4,
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('creates feedback with optional context field', async () => {
    mockPrisma.feedback.create.mockResolvedValue({
      id: 'fb-6',
      type: 'BUG',
      subject: 'Page crash',
      message: 'The page crashed when generating.',
      email: null,
      name: null,
      rating: null,
      context: '/create',
      userId: null,
      status: 'NEW',
      response: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createPostRequest({
      type: 'BUG',
      subject: 'Page crash',
      message: 'The page crashed when generating.',
      context: '/create',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('creates feedback with all optional fields provided', async () => {
    mockPrisma.feedback.create.mockResolvedValue({
      id: 'fb-7',
      type: 'CONCERN',
      subject: 'Privacy question',
      message: 'How is my data used?',
      email: 'bob@example.com',
      name: 'Bob',
      rating: 3,
      context: '/settings',
      userId: null,
      status: 'NEW',
      response: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createPostRequest({
      type: 'CONCERN',
      subject: 'Privacy question',
      message: 'How is my data used?',
      email: 'bob@example.com',
      name: 'Bob',
      rating: 3,
      context: '/settings',
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it('rejects missing type field', async () => {
    const request = createPostRequest({
      subject: 'No type',
      message: 'Missing the type field.',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('rejects invalid type value', async () => {
    const request = createPostRequest({
      type: 'INVALID_TYPE',
      subject: 'Bad type',
      message: 'This type does not exist.',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('rejects missing subject field', async () => {
    const request = createPostRequest({
      type: 'GENERAL',
      message: 'Missing subject.',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects empty subject field', async () => {
    const request = createPostRequest({
      type: 'GENERAL',
      subject: '',
      message: 'Empty subject.',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects missing message field', async () => {
    const request = createPostRequest({
      type: 'GENERAL',
      subject: 'Has subject',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects empty message field', async () => {
    const request = createPostRequest({
      type: 'GENERAL',
      subject: 'Has subject',
      message: '',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects subject exceeding 200 characters', async () => {
    const request = createPostRequest({
      type: 'GENERAL',
      subject: 'a'.repeat(201),
      message: 'Valid message.',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects message exceeding 5000 characters', async () => {
    const request = createPostRequest({
      type: 'GENERAL',
      subject: 'Valid subject',
      message: 'a'.repeat(5001),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects invalid email format', async () => {
    const request = createPostRequest({
      ...validFeedback,
      email: 'not-an-email',
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects rating below 1', async () => {
    const request = createPostRequest({
      ...validFeedback,
      rating: 0,
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects rating above 5', async () => {
    const request = createPostRequest({
      ...validFeedback,
      rating: 6,
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects non-integer rating', async () => {
    const request = createPostRequest({
      ...validFeedback,
      rating: 3.5,
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects name exceeding 100 characters', async () => {
    const request = createPostRequest({
      ...validFeedback,
      name: 'a'.repeat(101),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('rejects context exceeding 500 characters', async () => {
    const request = createPostRequest({
      ...validFeedback,
      context: 'a'.repeat(501),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it('accepts all valid feedback types', async () => {
    const types = ['BUG', 'FEATURE_REQUEST', 'GENERAL', 'PRAISE', 'CONCERN'];

    for (const type of types) {
      mockPrisma.feedback.create.mockResolvedValue({
        id: `fb-${type}`,
        type,
        subject: 'Test',
        message: 'Test message',
        email: null,
        name: null,
        rating: null,
        context: null,
        userId: null,
        status: 'NEW',
        response: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const request = createPostRequest({
        type,
        subject: 'Test',
        message: 'Test message',
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    }
  });

  it('accepts rating at boundary values (1 and 5)', async () => {
    for (const rating of [1, 5]) {
      mockPrisma.feedback.create.mockResolvedValue({
        id: `fb-rating-${rating}`,
        type: 'GENERAL',
        subject: 'Rating test',
        message: 'Testing boundary ratings.',
        email: null,
        name: null,
        rating,
        context: null,
        userId: null,
        status: 'NEW',
        response: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = createPostRequest({
        ...validFeedback,
        subject: 'Rating test',
        message: 'Testing boundary ratings.',
        rating,
      });
      const response = await POST(request);
      expect(response.status).toBe(201);
    }
  });

});

describe('GET /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
  });

  it('returns 403 for non-admin users', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'USER' } });

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns 403 for unauthenticated requests', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('returns a list of feedbacks for admin', async () => {
    const mockFeedbacks = [
      {
        id: 'fb-1',
        type: 'GENERAL',
        subject: 'Nice',
        message: 'Great app!',
        email: null,
        name: null,
        rating: 5,
        context: null,
        userId: null,
        status: 'NEW',
        response: null,
        createdAt: new Date('2025-01-15'),
        updatedAt: new Date('2025-01-15'),
      },
    ];
    mockPrisma.feedback.findMany.mockResolvedValue(mockFeedbacks);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it('returns empty array when no feedback exists', async () => {
    mockPrisma.feedback.findMany.mockResolvedValue([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });
});
