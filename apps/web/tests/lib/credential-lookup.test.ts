import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateResponse = vi.fn();

vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: (...args: unknown[]) => mockGenerateResponse(...args) }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auto-model-config', () => ({
  resolveAutoModel: vi.fn().mockResolvedValue({
    aiProvider: 'anthropic',
    aiModel: 'claude-test-model',
    ttsProvider: 'openai',
    ttsModel: 'tts-1-hd',
    sttProvider: 'openai',
    sttModel: 'whisper-1',
  }),
}));

vi.mock('@/lib/usage-logger', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prompt-loader', () => ({
  loadPrompt: vi.fn().mockReturnValue('You are a credential lookup agent.'),
}));

import { lookupParticipantCredentials } from '@/lib/credential-lookup';
import type { ParticipantInput } from '@/lib/credential-lookup';

describe('lookupParticipantCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Returns credentials for verified participants
  it('returns credentials for verified participants', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        participants: [
          { username: 'drsmith', credentials: 'Professor of Physics at MIT', confidence: 0.9, source: 'MIT faculty page' },
        ],
      }),
      inputTokens: 500,
      outputTokens: 300,
    });

    const result = await lookupParticipantCredentials([
      { authorUsername: 'drsmith', authorName: 'Dr. Smith', authorBio: 'Physics professor' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('drsmith');
    expect(result[0].credentials).toBe('Professor of Physics at MIT');
    expect(result[0].confidence).toBe(0.85); // capped
    expect(result[0].source).toBe('MIT faculty page');
  });

  // Test 2: Filters out low-confidence results
  it('filters out low-confidence results', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({
        participants: [
          { username: 'user1', credentials: 'Some title', confidence: 0.5, source: 'unclear' },
          { username: 'user2', credentials: 'CEO of Acme', confidence: 0.85, source: 'LinkedIn' },
        ],
      }),
      inputTokens: 500,
      outputTokens: 300,
    });

    const result = await lookupParticipantCredentials([
      { authorUsername: 'user1', authorName: 'User 1' },
      { authorUsername: 'user2', authorName: 'User 2' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('user2');
  });

  // Test 3: Caps at 5 participants
  it('caps at 5 participants', async () => {
    mockGenerateResponse.mockResolvedValue({
      content: JSON.stringify({ participants: [] }),
      inputTokens: 500,
      outputTokens: 100,
    });

    const participants: ParticipantInput[] = Array.from({ length: 8 }, (_, i) => ({
      authorUsername: `user${i}`,
      authorName: `User ${i}`,
    }));

    await lookupParticipantCredentials(participants);

    const userMessage = mockGenerateResponse.mock.calls[0][1][0].content;
    // Should only contain 5 participants
    const mentionCount = (userMessage.match(/@user/g) || []).length;
    expect(mentionCount).toBe(5);
  });

  // Test 4: Handles empty participant list
  it('handles empty participant list', async () => {
    const result = await lookupParticipantCredentials([]);

    expect(result).toEqual([]);
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  // Test 5: Handles Claude errors gracefully
  it('handles Claude errors gracefully', async () => {
    mockGenerateResponse.mockRejectedValue(new Error('API rate limited'));

    const result = await lookupParticipantCredentials([
      { authorUsername: 'user1', authorName: 'User 1' },
    ]);

    expect(result).toEqual([]);
  });
});
