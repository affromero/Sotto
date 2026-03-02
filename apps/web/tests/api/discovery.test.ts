import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Define mock fns at module scope so they're properly typed as Mock
const mockAuth = vi.fn();
const mockDiscoveryFindUniqueOrThrow = vi.fn();
const mockStreamDiscoveryResponse = vi.fn();
const mockStreamFallbackDiscoveryResponse = vi.fn();
const mockParseChips = vi.fn();
const mockParseMetadata = vi.fn();
const mockGetAiKey = vi.fn();
const mockUserFindUnique = vi.fn();
const mockDetectLanguage = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const mockUserAiKeyUpdateMany = vi.fn();

vi.mock('@/lib/prisma', () => {
  const _mockPrisma = {
    discovery: {
      findUniqueOrThrow: (...args: unknown[]) => mockDiscoveryFindUniqueOrThrow(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    userAiKey: {
      updateMany: (...args: unknown[]) => mockUserAiKeyUpdateMany(...args),
    },
    discoveryChatError: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return { prisma: _mockPrisma, prismaUnfiltered: _mockPrisma };
});

vi.mock('@/lib/byok', () => ({
  getAiKey: (...args: unknown[]) => mockGetAiKey(...args),
}));

vi.mock('@/lib/llm', () => ({
  logApiUsage: vi.fn(),
}));

vi.mock('@/lib/discovery-agent', () => ({
  streamDiscoveryResponse: (...args: unknown[]) => mockStreamDiscoveryResponse(...args),
  streamFallbackDiscoveryResponse: (...args: unknown[]) => mockStreamFallbackDiscoveryResponse(...args),
  parseChips: (...args: unknown[]) => mockParseChips(...args),
  parseMetadata: (...args: unknown[]) => mockParseMetadata(...args),
  detectUrls: () => [],
}));

vi.mock('@/lib/language-detect', () => ({
  detectLanguage: (...args: unknown[]) => mockDetectLanguage(...args),
}));

vi.mock('@/lib/extractors', () => ({
  extractContent: vi.fn().mockResolvedValue({ text: '', markdown: '' }),
}));

vi.mock('@/lib/redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: false, remaining: 0, resetAt: 0 }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '@/app/api/discovery/route';

const mockPrisma = {
  discovery: {
    findUniqueOrThrow: mockDiscoveryFindUniqueOrThrow,
  },
};

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/discovery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const mockDiscoveryWithMessages = {
  id: 'disc-1',
  userId: 'user-1',
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:05:00Z'),
  messages: [
    {
      id: 'msg-1',
      role: 'assistant',
      content: 'What topic would you like to explore?',
      chips: ['Science', 'Technology', 'History'],
      createdAt: new Date('2025-01-15T10:00:00Z'),
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'Quantum computing',
      chips: [],
      createdAt: new Date('2025-01-15T10:01:00Z'),
    },
  ],
};

async function* mockStreamGenerator(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function readSSEStream(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No readable body');

  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        events.push(line.slice(6));
      }
    }
  }

  return events;
}

describe('POST /api/discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAiKey.mockResolvedValue({ apiKey: 'test-ai-key' });
    mockUserFindUnique.mockResolvedValue({ plan: 'FREE', preferredLanguage: null });
    mockDetectLanguage.mockReturnValue(null);
  });

  describe('Authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuth.mockResolvedValue(null);

      const request = createPostRequest({
        message: 'Tell me about quantum computing',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 401 when session exists but user.id is missing', async () => {
      mockAuth.mockResolvedValue({ user: {} });

      const request = createPostRequest({
        message: 'Tell me about quantum computing',
      });
      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('allows request when user is authenticated with valid session', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Hello']));
      mockParseChips.mockReturnValue({ text: 'Hello', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Tell me about quantum computing',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    });
  });

  describe('Message handling without discoveryId', () => {
    it('processes new conversation without discoveryId', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(
        mockStreamGenerator(['What ', 'topic ', 'interests you?'])
      );
      mockParseChips.mockReturnValue({
        text: 'What topic interests you?',
        chips: ['Science', 'Tech', 'History'],
      });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'I want to learn something new',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

  });

  describe('Message handling with discoveryId', () => {
    it('fetches existing discovery with messages when discoveryId is provided', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockPrisma.discovery.findUniqueOrThrow.mockResolvedValue(mockDiscoveryWithMessages);
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'What is a qubit?',
        discoveryId: 'disc-1',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('builds message history from existing discovery messages', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockPrisma.discovery.findUniqueOrThrow.mockResolvedValue(mockDiscoveryWithMessages);
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'What is a qubit?',
        discoveryId: 'disc-1',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('appends new user message to existing history', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockPrisma.discovery.findUniqueOrThrow.mockResolvedValue(mockDiscoveryWithMessages);
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Tell me more',
        discoveryId: 'disc-1',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('SSE streaming response', () => {
    it('returns response with correct SSE headers', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Hello']));
      mockParseChips.mockReturnValue({ text: 'Hello', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Test',
      });
      const response = await POST(request);

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Connection')).toBe('keep-alive');
    });

    it('streams text chunks as SSE data events', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Hello ', 'world', '!']));
      mockParseChips.mockReturnValue({ text: 'Hello world!', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Test',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      expect(events.length).toBeGreaterThanOrEqual(3);
      const textEvents = events.slice(0, -1);
      expect(textEvents[0]).toContain('"text":"Hello "');
      expect(textEvents[1]).toContain('"text":"world"');
      expect(textEvents[2]).toContain('"text":"!"');
    });

    it('sends final done event with chips and metadata', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response text']));
      mockParseChips.mockReturnValue({
        text: 'Response text',
        chips: ['Option A', 'Option B'],
      });
      mockParseMetadata.mockReturnValue({
        topic: 'Quantum Computing',
        depth: 'standard',
        audience_level: 'intermediate',
        focus_areas: ['qubits', 'entanglement'],
        tone: 'professional',
        duration_target: 10,
        ready: true,
      });

      const request = createPostRequest({
        message: 'Generate podcast about quantum computing',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.done).toBe(true);
      expect(finalData.chips).toEqual(['Option A', 'Option B']);
      expect(finalData.metadata).toEqual({
        topic: 'Quantum Computing',
        depth: 'standard',
        audienceLevel: 'intermediate',
        focusAreas: ['qubits', 'entanglement'],
        tone: 'professional',
        durationTarget: 10,
        ready: true,
      });
    });

    it('accumulates full response text before parsing chips and metadata', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(
        mockStreamGenerator(['Part 1 ', 'Part 2 ', 'Part 3'])
      );
      mockParseChips.mockReturnValue({ text: 'Part 1 Part 2 Part 3', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Test',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      expect(response.status).toBe(200);
      expect(events.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Chip and metadata parsing', () => {
    it('includes parsed chips in final event when present', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Choose one']));
      mockParseChips.mockReturnValue({
        text: 'Choose one',
        chips: ['Science', 'Tech', 'Art'],
      });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'What can I learn?',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.chips).toEqual(['Science', 'Tech', 'Art']);
    });

    it('includes empty chips array when no chips are parsed', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Plain text']));
      mockParseChips.mockReturnValue({ text: 'Plain text', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Tell me more',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.chips).toEqual([]);
    });

    it('includes parsed metadata in final event when present', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Ready!']));
      mockParseChips.mockReturnValue({ text: 'Ready!', chips: [] });
      mockParseMetadata.mockReturnValue({
        topic: 'Machine Learning',
        depth: 'deep_dive',
        audience_level: 'expert',
        focus_areas: ['neural networks', 'transformers'],
        tone: 'professional',
        duration_target: 15,
        ready: true,
      });

      const request = createPostRequest({
        message: 'Yes, create it',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.metadata).toEqual({
        topic: 'Machine Learning',
        depth: 'deep_dive',
        audienceLevel: 'expert',
        focusAreas: ['neural networks', 'transformers'],
        tone: 'professional',
        durationTarget: 15,
        ready: true,
      });
    });

    it('includes null metadata when no metadata is parsed', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Not ready yet']));
      mockParseChips.mockReturnValue({ text: 'Not ready yet', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Continue',
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.metadata).toBeNull();
    });
  });

  describe('Edge cases and validation', () => {
    it('handles empty message string', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

      const request = createPostRequest({
        message: '',
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Message is required');
    });

    it('handles very long message string', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const longMessage = 'a'.repeat(5000);
      const request = createPostRequest({
        message: longMessage,
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('handles missing message field', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

      const request = createPostRequest({
        discoveryId: 'disc-1',
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Message is required');
    });

    it('handles discovery with no existing messages', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockPrisma.discovery.findUniqueOrThrow.mockResolvedValue({
        id: 'disc-1',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
      });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Hello',
        discoveryId: 'disc-1',
      });
      await POST(request);

      expect(mockStreamDiscoveryResponse).toHaveBeenCalledWith(
        [{ role: 'user', content: 'Hello' }],
        'test-ai-key',
        undefined,
        expect.any(Function),
        'anthropic',
        undefined,
      );
    });

    it('handles streaming error by sending error SSE event', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

      async function* errorGenerator() {
        yield 'Part 1';
        throw new Error('Streaming error');
      }

      mockStreamDiscoveryResponse.mockReturnValue(errorGenerator());

      const request = createPostRequest({
        message: 'Test',
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const events = await readSSEStream(response);
      const errorEvent = events.find((e) => {
        try {
          return JSON.parse(e).error;
        } catch {
          return false;
        }
      });

      expect(errorEvent).toBeDefined();
      const parsed = JSON.parse(errorEvent!);
      expect(parsed.error).toContain('An error occurred');
    });

    it('sends auth error and marks key invalid on 401', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockGetAiKey.mockResolvedValue({ apiKey: 'bad-key', provider: 'anthropic' });
      mockUserAiKeyUpdateMany.mockResolvedValue({ count: 1 });

      const authError = new Error('Invalid API key');
      (authError as unknown as Record<string, unknown>).status = 401;

      async function* authErrorGenerator() {
        throw authError;
      }

      mockStreamDiscoveryResponse.mockReturnValue(authErrorGenerator());

      const request = createPostRequest({ message: 'Test' });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const errorEvent = events.find((e) => {
        try {
          return JSON.parse(e).error;
        } catch {
          return false;
        }
      });

      const parsed = JSON.parse(errorEvent!);
      expect(parsed.error).toContain('invalid or has been revoked');
      expect(mockUserAiKeyUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', provider: 'anthropic' },
        data: { isValid: false },
      });
    });

    it('preserves message role types from discovery', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockPrisma.discovery.findUniqueOrThrow.mockResolvedValue({
        id: 'disc-1',
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Question 1',
            chips: [],
            createdAt: new Date(),
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Answer 1',
            chips: [],
            createdAt: new Date(),
          },
        ],
      });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Question 2',
        discoveryId: 'disc-1',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('streams fallback podcast suggestions and logs DiscoveryChatError when response is markup-only', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      // Claude returns only a metadata block with no prose text
      mockStreamDiscoveryResponse.mockReturnValue(
        mockStreamGenerator(['[METADATA]{"topic":"test","ready":false}[/METADATA]'])
      );
      // Fallback returns helpful podcast angle suggestions
      mockStreamFallbackDiscoveryResponse.mockReturnValue(
        mockStreamGenerator(['Here are some podcast angles you could explore. [chips: Angle A · Angle B · Angle C]'])
      );
      mockParseChips.mockReturnValue({ text: 'Here are some podcast angles you could explore.', chips: ['Angle A', 'Angle B', 'Angle C'] });

      const { prisma: mockPrismaRef } = await import('@/lib/prisma');

      const request = createPostRequest({ message: 'Mexican security forces kill El Mencho' });
      const response = await POST(request);
      const events = await readSSEStream(response);

      // Should stream fallback text, not a static error
      const textEvents = events.filter((e) => {
        try { return 'text' in JSON.parse(e); } catch { return false; }
      });
      expect(textEvents.length).toBeGreaterThan(0);
      // No static error event
      const errorEvent = events.find((e) => {
        try { return JSON.parse(e).error; } catch { return false; }
      });
      expect(errorEvent).toBeUndefined();
      // Error still logged to DB
      expect(mockPrismaRef.discoveryChatError.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ errorKind: 'empty_response' }),
        })
      );
      // Fallback was invoked
      expect(mockStreamFallbackDiscoveryResponse).toHaveBeenCalled();
    });

    it('handles multiple concurrent streams from different users', async () => {
      mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValueOnce(mockStreamGenerator(['Stream 1']));
      mockParseChips.mockReturnValue({ text: 'Stream 1', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request1 = createPostRequest({
        message: 'User 1 message',
      });
      const response1 = await POST(request1);

      expect(response1.status).toBe(200);

      mockAuth.mockResolvedValueOnce({ user: { id: 'user-2' } });
      mockStreamDiscoveryResponse.mockReturnValueOnce(mockStreamGenerator(['Stream 2']));
      mockParseChips.mockReturnValue({ text: 'Stream 2', chips: [] });

      const request2 = createPostRequest({
        message: 'User 2 message',
      });
      const response2 = await POST(request2);

      expect(response2.status).toBe(200);
    });
  });

  describe('BYOK key passthrough', () => {
    it('passes user AI key to streamDiscoveryResponse', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockGetAiKey.mockResolvedValue({ apiKey: 'user-anthropic-key-123' });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({ message: 'Test' });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('passes undefined when user has no AI key', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockGetAiKey.mockResolvedValue(null);
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({ message: 'Test' });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Language detection', () => {
    it('includes detectedLanguage in done event when first message is non-English and no preferredLanguage', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockDetectLanguage.mockReturnValue('es');
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({ message: 'Quiero aprender sobre la historia de España y su cultura mediterránea' });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.done).toBe(true);
      expect(finalData.detectedLanguage).toBe('es');
    });

    it('does not include detectedLanguage when preferredLanguage is already set', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockUserFindUnique.mockResolvedValue({ plan: 'FREE', preferredLanguage: 'es' });
      mockDetectLanguage.mockReturnValue('es');
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({ message: 'Quiero aprender sobre la historia de España y su cultura mediterránea' });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.done).toBe(true);
      expect(finalData.detectedLanguage).toBeUndefined();
    });

    it('does not include detectedLanguage when history is present (not first message)', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockDetectLanguage.mockReturnValue('es');
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Cuéntame más sobre este tema de la historia española',
        history: [
          { role: 'user', content: 'Hola' },
          { role: 'assistant', content: 'Hola, ¿qué te gustaría explorar?' },
        ],
      });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.done).toBe(true);
      expect(finalData.detectedLanguage).toBeUndefined();
    });

    it('does not include detectedLanguage when language is English', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockDetectLanguage.mockReturnValue('en');
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({ message: 'Tell me about quantum computing and its applications in modern science' });
      const response = await POST(request);
      const events = await readSSEStream(response);

      const finalEvent = events[events.length - 1];
      const finalData = JSON.parse(finalEvent);

      expect(finalData.done).toBe(true);
      expect(finalData.detectedLanguage).toBeUndefined();
    });
  });

  describe('Message content validation', () => {
    it('accepts message with special characters', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'What about quantum computing? #science @AI',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('accepts message with unicode characters', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Tell me about 量子计算 and émoji 🚀',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('accepts message with newlines', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
      mockStreamDiscoveryResponse.mockReturnValue(mockStreamGenerator(['Response']));
      mockParseChips.mockReturnValue({ text: 'Response', chips: [] });
      mockParseMetadata.mockReturnValue(null);

      const request = createPostRequest({
        message: 'Line 1\nLine 2\nLine 3',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });
});
