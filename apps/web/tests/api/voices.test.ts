import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetVoiceCatalog = vi.fn();
const mockCaptureCredential = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/voice-catalog', () => ({
  getVoiceCatalog: (...args: unknown[]) => mockGetVoiceCatalog(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/sidedoor/access/state/transaction', () => ({
  sottoTransaction: async (_database: unknown, operation: (database: object) => Promise<unknown>) =>
    operation({}),
}));
vi.mock('@/lib/sidedoor/access/core/request-identity', () => ({
  requireOriginalSottoAdmission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/credential-execution', () => ({
  captureSottoExecutionCredential: (...args: unknown[]) => mockCaptureCredential(...args),
  sottoExecutionCredentialFields: () => ({ apiKey: 'test-provider-key' }),
}));
vi.mock('@/lib/sidedoor/credentials/runtime/provider-execution', () => ({
  createSottoProviderTransport: vi.fn().mockResolvedValue({ authenticatedFetch: fetch }),
}));
vi.mock('@/lib/prisma', () => ({ prismaUnfiltered: {} }));

import { GET } from '@/app/api/v1/voices/route';

function createRequest(
  url = 'http://localhost:3000/api/v1/voices',
  options?: RequestInit
): NextRequest {
  return new NextRequest(url, options as ConstructorParameters<typeof NextRequest>[1]);
}

describe('GET /api/v1/voices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVoiceCatalog.mockResolvedValue([
      {
        id: 'voice-1',
        name: 'Adam',
        gender: 'male',
        accent: 'american',
        age: 'middle',
        description: 'warm narrator',
      },
      {
        id: 'voice-2',
        name: 'Bella',
        gender: 'female',
        accent: 'american',
        age: 'young',
        description: 'engaging storyteller',
      },
    ]);
    mockCaptureCredential.mockResolvedValue({ provider: 'test' });
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns preset pool voices for authenticated user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetVoiceCatalog).toHaveBeenCalledWith(
      'elevenlabs',
      'test-provider-key',
      expect.any(Function)
    );
    expect(body).toEqual({
      poolVoices: [
        {
          id: 'voice-1',
          name: 'Adam',
          gender: 'male',
          accent: 'american',
          ageRange: 'middle',
          character: 'warm narrator',
        },
        {
          id: 'voice-2',
          name: 'Bella',
          gender: 'female',
          accent: 'american',
          ageRange: 'young',
          character: 'engaging storyteller',
        },
      ],
    });
  });

  it('returns provider-specific preset voices when provider is set', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockGetVoiceCatalog.mockResolvedValue([
      {
        id: 'cartesia-1',
        name: 'Cartesia Voice',
        gender: 'female',
        accent: 'british',
        age: 'young',
        description: 'clear speaker',
      },
    ]);

    const response = await GET(
      createRequest('http://localhost:3000/api/v1/voices?provider=cartesia')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetVoiceCatalog).toHaveBeenCalledWith(
      'cartesia',
      'test-provider-key',
      expect.any(Function)
    );
    expect(body.poolVoices).toHaveLength(1);
    expect(body.poolVoices[0]).toMatchObject({
      id: 'cartesia-1',
      name: 'Cartesia Voice',
      ageRange: 'young',
      character: 'clear speaker',
    });
  });

  it('rejects invalid provider param', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });

    const response = await GET(
      createRequest('http://localhost:3000/api/v1/voices?provider=invalid')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid provider' });
    expect(mockGetVoiceCatalog).not.toHaveBeenCalled();
  });
});
