import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockAuthenticateRequest = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();
const mockVoiceCloneFindMany = vi.fn();
const mockVoiceCloneCount = vi.fn();
const mockVoiceCloneFindUnique = vi.fn();
const mockVoiceCloneCreate = vi.fn();
const mockVoiceCloneDelete = vi.fn();
const mockVoiceCloneUpdate = vi.fn();
const mockVoiceAllowlistFindMany = vi.fn();
const mockVoiceRequestFindMany = vi.fn();
const mockVoiceRequestDeleteMany = vi.fn();
const mockCloneVoice = vi.fn();
const mockDeleteClonedVoice = vi.fn();
const mockGenerateSpeech = vi.fn();
const mockGetVoiceById = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetVoiceCatalog = vi.fn();
const mockGetByokKey = vi.fn();
const mockCreateTtsProviderAsync = vi.fn();
const mockGetPlanFeatureConfig = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
    },
    voiceClone: {
      findMany: (...args: unknown[]) => mockVoiceCloneFindMany(...args),
      count: (...args: unknown[]) => mockVoiceCloneCount(...args),
      findUnique: (...args: unknown[]) => mockVoiceCloneFindUnique(...args),
      create: (...args: unknown[]) => mockVoiceCloneCreate(...args),
      delete: (...args: unknown[]) => mockVoiceCloneDelete(...args),
      update: (...args: unknown[]) => mockVoiceCloneUpdate(...args),
    },
    voiceAllowlist: {
      findMany: (...args: unknown[]) => mockVoiceAllowlistFindMany(...args),
    },
    voiceRequest: {
      findMany: (...args: unknown[]) => mockVoiceRequestFindMany(...args),
      deleteMany: (...args: unknown[]) => mockVoiceRequestDeleteMany(...args),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/stripe', () => ({
  LIMITS: {
    maxDurationMinutes: 30,
    maxVoiceClones: 10,
    canMakePrivate: true,
    canExportPdf: true,
    hasPremiumSfx: true,
  },
}));

vi.mock('@/lib/elevenlabs', () => ({
  cloneVoice: (...args: unknown[]) => mockCloneVoice(...args),
  deleteClonedVoice: (...args: unknown[]) => mockDeleteClonedVoice(...args),
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
  getVoiceById: (...args: unknown[]) => mockGetVoiceById(...args),
}));

vi.mock('@/lib/voice-catalog', () => ({
  getVoiceCatalog: (...args: unknown[]) => mockGetVoiceCatalog(...args),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  cache: { get: vi.fn(), set: vi.fn() },
}));

const mockUploadFile = vi.fn().mockResolvedValue('https://r2.example.com/sample.mp3');

vi.mock('@/lib/r2', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

const mockAddJob = vi.fn().mockResolvedValue({ id: 'job-1' });

vi.mock('@/lib/queue', () => ({
  addJob: (...args: unknown[]) => mockAddJob(...args),
  JobType: { VERIFY_VOICE: 'verify_voice' },
  voiceVerificationQueue: { name: 'voice-verification' },
}));

vi.mock('@/lib/byok', () => ({
  hasByokKey: vi.fn().mockResolvedValue(false),
  getByokKey: (...args: unknown[]) => mockGetByokKey(...args),
}));

vi.mock('@/lib/providers/tts', () => ({
  createTtsProviderAsync: (...args: unknown[]) => mockCreateTtsProviderAsync(...args),
}));

vi.mock('@/lib/tier-features', () => ({
  getTierFeatures: vi.fn().mockReturnValue({
    maxDurationMinutes: 30,
    maxSpeakers: 4,
    autoApproveScript: false,
    webSearchEnabled: true,
    maxQaInteractions: Infinity,
    privateAllowed: true,
    priorityQueue: true,
    analyticsEnabled: true,
    voiceTracksEnabled: true,
    maxVoiceTracks: 3,
    voiceCloningEnabled: true,
  }),
}));

vi.mock('@/lib/plan-feature-config', () => ({
  getPlanFeatureConfig: (...args: unknown[]) => mockGetPlanFeatureConfig(...args),
}));

vi.mock('@/lib/fal-voice-clone', () => ({
  cloneVoiceViaFal: vi.fn().mockResolvedValue({ voiceId: 'fal-voice-1' }),
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

import { GET } from '@/app/api/voices/route';
import {
  POST as POST_CLONE,
  PATCH as PATCH_CLONE,
  DELETE as DELETE_CLONE,
} from '@/app/api/voices/clone/route';
import { POST as POST_PREVIEW } from '@/app/api/voices/preview/route';

function createRequest(
  url = 'http://localhost:3000/api/voices',
  options?: RequestInit
): NextRequest {
  return new NextRequest(url, options as any);
}

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2025-12-31',
};

const defaultPlanFeatureConfig = {
  freeVoiceCloningEnabled: false,
  proVoiceCloningEnabled: true,
  freeVoiceTracksEnabled: false,
  proVoiceTracksEnabled: true,
  freeMaxVoiceTracks: 0,
  proMaxVoiceTracks: 3,
  voiceMarketplaceEnabled: true,
};

beforeEach(() => {
  mockGetPlanFeatureConfig.mockResolvedValue(defaultPlanFeatureConfig);
});

const mockVoiceClone = {
  id: 'clone-1',
  userId: 'user-1',
  name: 'My Voice',
  externalVoiceId: 'el-voice-1',
  sourceType: 'UPLOAD',
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
};

const mockVoiceClone2 = {
  id: 'clone-2',
  userId: 'user-1',
  name: 'Another Voice',
  externalVoiceId: 'el-voice-2',
  sourceType: 'RECORD',
  createdAt: new Date('2025-01-16T10:00:00Z'),
  updatedAt: new Date('2025-01-16T10:00:00Z'),
};

describe('GET /api/voices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUniqueOrThrow.mockResolvedValue({
      stripeAccountId: null,
      stripeOnboarded: false,
    });
    mockVoiceAllowlistFindMany.mockResolvedValue([]);
    mockVoiceRequestFindMany.mockResolvedValue([]);
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
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuthenticateRequest.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns voice pool, user clones, and maxVoiceClones for authenticated user', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockVoiceCloneFindMany.mockResolvedValue([
      {
        ...mockVoiceClone,
        provider: 'elevenlabs',
        description: null,
        requestable: false,
        priceInCents: null,
        voicePurchases: [],
      },
    ]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('poolVoices');
    expect(body).toHaveProperty('userClones');
    expect(body).toHaveProperty('maxVoiceClones');
    expect(body.maxVoiceClones).toBe(10);
    expect(Array.isArray(body.poolVoices)).toBe(true);
    expect(body.poolVoices).toHaveLength(2);
  });

  it('returns user voice clones with correct fields', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockVoiceCloneFindMany.mockResolvedValue([
      {
        id: 'clone-1',
        name: 'My Voice',
        externalVoiceId: 'el-voice-1',
        sourceType: 'UPLOAD',
        provider: 'elevenlabs',
        description: null,
        requestable: false,
        priceInCents: null,
        createdAt: mockVoiceClone.createdAt,
        voicePurchases: [],
      },
      {
        id: 'clone-2',
        name: 'Another Voice',
        externalVoiceId: 'el-voice-2',
        sourceType: 'RECORD',
        provider: 'elevenlabs',
        description: null,
        requestable: false,
        priceInCents: null,
        createdAt: mockVoiceClone2.createdAt,
        voicePurchases: [],
      },
    ]);

    const request = createRequest();
    const response = await GET(request);
    const body = await response.json();

    expect(body.userClones).toHaveLength(2);
    expect(body.userClones[0]).toMatchObject({
      id: 'clone-1',
      name: 'My Voice',
      externalVoiceId: 'el-voice-1',
      sourceType: 'UPLOAD',
      provider: 'elevenlabs',
    });
  });

  it('returns provider-specific pool voices when ?provider= is set', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockVoiceCloneFindMany.mockResolvedValue([]);
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

    const request = createRequest('http://localhost:3000/api/voices?provider=cartesia');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetVoiceCatalog).toHaveBeenCalledWith('cartesia');
    expect(body.poolVoices).toHaveLength(1);
    expect(body.poolVoices[0]).toMatchObject({
      id: 'cartesia-1',
      name: 'Cartesia Voice',
      ageRange: 'young',
      character: 'clear speaker',
    });
  });

  it('defaults to elevenlabs when provider param is missing', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockVoiceCloneFindMany.mockResolvedValue([]);

    const request = createRequest();
    await GET(request);

    expect(mockGetVoiceCatalog).toHaveBeenCalledWith('elevenlabs');
  });

  it('rejects invalid provider param', async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
    mockVoiceCloneFindMany.mockResolvedValue([]);

    const request = createRequest('http://localhost:3000/api/voices?provider=invalid');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid provider' });
    expect(mockGetVoiceCatalog).not.toHaveBeenCalled();
  });
});

describe('POST /api/voices/clone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUniqueOrThrow.mockResolvedValue({ plan: 'PRO', role: 'USER' });
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 403 when user reaches voice clone limit', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneCount.mockResolvedValue(10);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Maximum of 10 voice clones allowed' });
  });

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneCount.mockResolvedValue(0);

    const formData = new FormData();
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when sourceType is invalid', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneCount.mockResolvedValue(0);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'INVALID');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when audio file is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneCount.mockResolvedValue(0);

    const formData = new FormData();
    formData.append('name', 'Test Voice');
    formData.append('sourceType', 'UPLOAD');

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'POST',
      body: formData,
    });
    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Audio file is required' });
  });

  it('successfully creates voice clone for authenticated user', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneCount.mockResolvedValue(1);
    mockCloneVoice.mockResolvedValue({ voiceId: 'el-voice-new' });
    mockVoiceCloneCreate.mockResolvedValue({
      id: 'clone-new',
      userId: 'user-1',
      name: 'My Custom Voice',
      externalVoiceId: 'el-voice-new',
      sourceType: 'UPLOAD',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      updatedAt: new Date('2025-01-20T10:00:00Z'),
    });

    const audioBuffer = Buffer.from('fake-audio-data');
    const mockFile = {
      arrayBuffer: async () => audioBuffer,
      name: 'voice.mp3',
      type: 'audio/mpeg',
    } as any as File;

    const mockFormData = new Map<string, any>([
      ['name', 'My Custom Voice'],
      ['sourceType', 'UPLOAD'],
      ['audio', mockFile],
    ]);

    const request = {
      formData: async () =>
        ({
          get: (key: string) => mockFormData.get(key),
        }) as any,
    } as unknown as NextRequest;

    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('clone-new');
    expect(body.name).toBe('My Custom Voice');
    expect(body.externalVoiceId).toBe('el-voice-new');
  });

  it('successfully creates voice clone with RECORD source type', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneCount.mockResolvedValue(3);
    mockCloneVoice.mockResolvedValue({ voiceId: 'el-voice-studio' });
    mockVoiceCloneCreate.mockResolvedValue({
      id: 'clone-studio',
      userId: 'user-1',
      name: 'Studio Voice',
      externalVoiceId: 'el-voice-studio',
      sourceType: 'RECORD',
      createdAt: new Date('2025-01-20T10:00:00Z'),
      updatedAt: new Date('2025-01-20T10:00:00Z'),
    });

    const audioBuffer = Buffer.from('fake-audio-data');
    const mockFile = {
      arrayBuffer: async () => audioBuffer,
      name: 'voice.mp3',
      type: 'audio/mpeg',
    } as any as File;

    const mockFormData = new Map<string, any>([
      ['name', 'Studio Voice'],
      ['sourceType', 'RECORD'],
      ['audio', mockFile],
    ]);

    const request = {
      formData: async () =>
        ({
          get: (key: string) => mockFormData.get(key),
        }) as any,
    } as unknown as NextRequest;

    const response = await POST_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('clone-studio');
    expect(body.sourceType).toBe('RECORD');
  });

  describe('ElevenLabs IMPORT flow', () => {
    function makeImportRequest(externalVoiceId: string) {
      const mockFormData = new Map<string, unknown>([
        ['provider', 'elevenlabs'],
        ['sourceType', 'IMPORT'],
        ['externalVoiceId', externalVoiceId],
      ]);
      return {
        formData: async () => ({ get: (key: string) => mockFormData.get(key) }) as any,
      } as unknown as NextRequest;
    }

    it('imports a valid voice ID and returns 201 with name from EL API', async () => {
      mockAuth.mockResolvedValue(mockSession);
      mockVoiceCloneCount.mockResolvedValue(0);
      mockGetVoiceById.mockResolvedValue({ name: 'Adam', labels: {} });
      mockVoiceCloneFindUnique.mockResolvedValue(null);
      mockVoiceCloneCreate.mockResolvedValue({
        id: 'import-1',
        userId: 'user-1',
        name: 'Adam',
        externalVoiceId: 'WOrdX7PQdxpL0gxOtCs3',
        sourceType: 'IMPORT',
        provider: 'elevenlabs',
        verificationStatus: 'ADMIN_VERIFIED',
      });

      const response = await POST_CLONE(makeImportRequest('WOrdX7PQdxpL0gxOtCs3'));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.name).toBe('Adam');
      expect(body.sourceType).toBe('IMPORT');
      expect(body.verificationStatus).toBe('ADMIN_VERIFIED');
    });

    it('returns 404 when voice ID does not exist on ElevenLabs', async () => {
      mockAuth.mockResolvedValue(mockSession);
      mockVoiceCloneCount.mockResolvedValue(0);
      mockGetVoiceById.mockResolvedValue(null);

      const response = await POST_CLONE(makeImportRequest('nonexistent-id'));
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toMatch(/Voice ID not found/);
    });

    it('returns 409 when voice ID is already in the library', async () => {
      mockAuth.mockResolvedValue(mockSession);
      mockVoiceCloneCount.mockResolvedValue(0);
      mockGetVoiceById.mockResolvedValue({ name: 'Adam', labels: {} });
      mockVoiceCloneFindUnique.mockResolvedValue({ id: 'existing-1' });

      const response = await POST_CLONE(makeImportRequest('WOrdX7PQdxpL0gxOtCs3'));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toMatch(/already in your library/);
    });
  });
});

describe('PATCH /api/voices/clone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlanFeatureConfig.mockResolvedValue(defaultPlanFeatureConfig);
  });

  it('updates the voice clone description for its owner', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({ ...mockVoiceClone, userId: 'user-1' });
    mockVoiceCloneUpdate.mockResolvedValue({ ...mockVoiceClone, description: 'A warm narrator' });

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'PATCH',
      body: JSON.stringify({ voiceCloneId: 'clone-1', description: 'A warm narrator' }),
    });
    const response = await PATCH_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.description).toBe('A warm narrator');
    expect(mockVoiceCloneUpdate).toHaveBeenCalledWith({
      where: { id: 'clone-1' },
      data: { description: 'A warm narrator' },
    });
  });

  it('returns 400 when description is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'PATCH',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await PATCH_CLONE(request);

    expect(response.status).toBe(400);
    expect(mockVoiceCloneUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when editing another user's voice clone", async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({ ...mockVoiceClone, userId: 'user-2' });

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'PATCH',
      body: JSON.stringify({ voiceCloneId: 'clone-1', description: 'hijack' }),
    });
    const response = await PATCH_CLONE(request);

    expect(response.status).toBe(403);
    expect(mockVoiceCloneUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/voices/clone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when voiceCloneId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'voiceCloneId is required' });
  });

  it('returns 404 when voice clone does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'nonexistent' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: 'Voice clone not found' });
  });

  it("returns 403 when user tries to delete another user's voice clone", async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({
      id: 'clone-1',
      userId: 'user-2',
      name: 'Other User Voice',
      externalVoiceId: 'el-voice-1',
      sourceType: 'UPLOAD',
    });

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: 'Forbidden' });
  });

  it('successfully deletes voice clone from ElevenLabs and database', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue(mockVoiceClone);
    mockDeleteClonedVoice.mockResolvedValue(undefined);
    mockVoiceRequestDeleteMany.mockResolvedValue({ count: 0 });
    mockVoiceCloneDelete.mockResolvedValue(mockVoiceClone);

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-1' }),
    });
    const response = await DELETE_CLONE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it('does not call ElevenLabs API when deleting an IMPORT voice', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockVoiceCloneFindUnique.mockResolvedValue({
      id: 'clone-import',
      userId: 'user-1',
      name: 'Adam',
      externalVoiceId: 'WOrdX7PQdxpL0gxOtCs3',
      sourceType: 'IMPORT',
      provider: 'elevenlabs',
    });
    mockVoiceRequestDeleteMany.mockResolvedValue({ count: 0 });
    mockVoiceCloneDelete.mockResolvedValue({});

    const request = createRequest('http://localhost:3000/api/voices/clone', {
      method: 'DELETE',
      body: JSON.stringify({ voiceCloneId: 'clone-import' }),
    });
    const response = await DELETE_CLONE(request);

    expect(response.status).toBe(200);
    expect(mockDeleteClonedVoice).not.toHaveBeenCalled();
  });
});

describe('POST /api/voices/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByokKey.mockResolvedValue('user-elevenlabs-key');
    mockCreateTtsProviderAsync.mockResolvedValue({
      generateSpeech: vi.fn().mockResolvedValue(Buffer.from('fake-audio-data')),
    });
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CARTESIA_API_KEY;
    delete process.env.HUME_API_KEY;
    delete process.env.FAL_KEY;
    delete process.env.REPLICATE_API_TOKEN;
    delete process.env.MISTRAL_API_KEY;
  });

  it('returns 401 when user is not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ error: 'Rate limit exceeded. Try again in a minute.' });
  });

  it('returns 400 when voiceId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when text is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1' }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when text exceeds 500 characters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'a'.repeat(501) }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when provider is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world' }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when no provider key is available', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mockGetByokKey.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({ voiceId: 'voice-1', text: 'Hello world', provider: 'elevenlabs' }),
    });
    const response = await POST_PREVIEW(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('No elevenlabs API key available');
  });

  it('successfully generates voice preview audio', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'ADMIN' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mockUserFindUniqueOrThrow.mockResolvedValue({ role: 'ADMIN' });
    const mockAudioBuffer = Buffer.from('fake-audio-data');
    const generateSpeech = vi.fn().mockResolvedValue(mockAudioBuffer);
    mockCreateTtsProviderAsync.mockResolvedValue({ generateSpeech });

    const request = createRequest('http://localhost:3000/api/voices/preview', {
      method: 'POST',
      body: JSON.stringify({
        voiceId: 'voice-1',
        text: 'Hello world, this is a preview.',
        provider: 'elevenlabs',
      }),
    });
    const response = await POST_PREVIEW(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Content-Length')).toBe(mockAudioBuffer.length.toString());
    expect(mockCreateTtsProviderAsync).toHaveBeenCalledWith('elevenlabs', 'user-elevenlabs-key');
    expect(generateSpeech).toHaveBeenCalledWith({
      text: 'Hello world, this is a preview.',
      voiceId: 'voice-1',
    });
  });
});
