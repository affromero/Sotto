import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getReadiness } from '@/app/api/onboarding/readiness/route';

const mockAuth = vi.fn();
const mockListAiProviders = vi.fn();
const mockListByokProviders = vi.fn();
const mockUserFindUnique = vi.fn();
const mockPrivateFeedTokenCount = vi.fn();
const mockIsClaudeAvailable = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/byok', () => ({
  listAiProviders: (...args: unknown[]) => mockListAiProviders(...args),
  listByokProviders: (...args: unknown[]) => mockListByokProviders(...args),
}));

vi.mock('@/lib/claude-code-client', () => ({
  isClaudeAvailable: (...args: unknown[]) => mockIsClaudeAvailable(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    privateFeedToken: {
      count: (...args: unknown[]) => mockPrivateFeedTokenCount(...args),
    },
  },
}));

describe('GET /api/onboarding/readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('STT_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', '');
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockUserFindUnique.mockResolvedValue({
      preferredAiModel: 'openai',
      preferredTtsProvider: 'openai',
    });
    mockListAiProviders.mockResolvedValue([]);
    mockListByokProviders.mockResolvedValue([]);
    mockPrivateFeedTokenCount.mockResolvedValue(0);
    mockIsClaudeAvailable.mockResolvedValue(false);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await getReadiness();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns setup readiness for the signed-in user', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    mockPrivateFeedTokenCount.mockResolvedValue(1);

    const response = await getReadiness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.readyCount).toBe(body.totalCount);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        preferredAiModel: true,
        preferredTtsProvider: true,
      },
    });
    expect(mockPrivateFeedTokenCount).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
    });
    expect(mockIsClaudeAvailable).not.toHaveBeenCalled();
  });

  it('reports the first missing setup action without using another configured provider', async () => {
    mockUserFindUnique.mockResolvedValue({
      preferredAiModel: 'anthropic',
      preferredTtsProvider: 'openai',
    });
    mockListAiProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);
    mockListByokProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);
    mockPrivateFeedTokenCount.mockResolvedValue(1);

    const response = await getReadiness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.nextAction.id).toBe('generation');
    expect(body.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'generation',
          status: 'action_required',
        }),
      ])
    );
  });

  it('reports Claude Code setup as missing when the selected CLI is unavailable', async () => {
    mockUserFindUnique.mockResolvedValue({
      preferredAiModel: 'claude-code:sonnet',
      preferredTtsProvider: 'openai',
    });
    mockListByokProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);
    mockPrivateFeedTokenCount.mockResolvedValue(1);
    mockIsClaudeAvailable.mockResolvedValue(false);

    const response = await getReadiness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockIsClaudeAvailable).toHaveBeenCalledOnce();
    expect(body.ready).toBe(false);
    expect(body.nextAction.id).toBe('generation');
    expect(body.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'generation',
          status: 'action_required',
          detail: "Install and authenticate the 'claude' CLI for Claude Code.",
        }),
      ])
    );
  });

  it('does not count an OpenAI TTS key as OpenAI transcription readiness', async () => {
    mockUserFindUnique.mockResolvedValue({
      preferredAiModel: 'openai',
      preferredTtsProvider: 'openai',
    });
    mockListAiProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);
    mockListByokProviders.mockResolvedValue([{ provider: 'openai', isValid: true }]);
    mockPrivateFeedTokenCount.mockResolvedValue(1);

    const response = await getReadiness();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'stt',
          status: 'ready',
          detail: 'openai selected',
        }),
      ])
    );

    mockListAiProviders.mockResolvedValue([]);

    const missingResponse = await getReadiness();
    const missingBody = await missingResponse.json();

    expect(missingResponse.status).toBe(200);
    expect(missingBody.ready).toBe(false);
    expect(missingBody.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'stt',
          status: 'action_required',
          detail: 'Add the openai STT key.',
        }),
      ])
    );
  });
});
