import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuthenticateRequest = vi.fn();
const mockCourseFindFirst = vi.fn();
const mockResolveLearningAi = vi.fn();
const mockGenerateResponse = vi.fn();
const mockLogUsage = vi.fn();

vi.mock('@/lib/api-keys', () => ({
  authenticateRequest: (...a: unknown[]) => mockAuthenticateRequest(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    course: {
      findFirst: (...a: unknown[]) => mockCourseFindFirst(...a),
    },
  },
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveLearningAi: (...a: unknown[]) => mockResolveLearningAi(...a),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({ generateResponse: mockGenerateResponse }),
}));
vi.mock('@/lib/usage-logger', () => ({
  logUsage: (...a: unknown[]) => mockLogUsage(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/v1/courses/[courseId]/selection-help/route';

const COURSE_PARAMS = { params: Promise.resolve({ courseId: 'course-1' }) };
const EXAMPLES = {
  examples: [
    { sentence: 'Ich heiße Ana.', note: 'Ein einfacher Satz mit einem Namen.' },
    { sentence: 'Hallo, ich heiße Max.', note: 'Gut für eine Vorstellung.' },
    { sentence: 'Ich heiße Leo und ich lerne Deutsch.', note: 'Der Satz bleibt kurz.' },
  ],
};

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/courses/course-1/selection-help', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateRequest.mockResolvedValue({ userId: 'user-1' });
  mockCourseFindFirst.mockResolvedValue({
    nativeLang: 'en',
    targetLang: 'de',
    currentLevel: 'A2',
  });
  mockResolveLearningAi.mockResolvedValue({
    provider: 'anthropic',
    model: 'claude-test',
    apiKey: 'key',
  });
  mockGenerateResponse.mockResolvedValue({
    content: JSON.stringify(EXAMPLES),
    inputTokens: 11,
    outputTokens: 22,
    model: 'claude-test',
  });
});

describe('POST /api/v1/courses/[courseId]/selection-help', () => {
  it('generates three easy examples for a selected class phrase', async () => {
    const res = await POST(
      jsonReq({ text: 'ich heiße', contextText: 'Hallo, ich heiße Anna.' }),
      COURSE_PARAMS
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'ich heiße', examples: EXAMPLES.examples });
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: 'course-1', userId: 'user-1' },
      select: { nativeLang: true, targetLang: true, currentLevel: true },
    });
    expect(mockGenerateResponse).toHaveBeenCalledWith(
      expect.stringContaining('Do not return a raw translation.'),
      [
        {
          role: 'user',
          content: expect.stringContaining('Selected text: ich heiße'),
        },
      ],
      expect.objectContaining({
        jsonSchema: expect.objectContaining({ name: 'selection_help_examples' }),
      })
    );
    expect(mockGenerateResponse.mock.calls[0][0]).toContain('Immediate immersion for A2');
    expect(mockLogUsage).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'selection-help', userId: 'user-1' })
    );
  });

  it('allows A1 examples to pair target sentences with source-language notes', async () => {
    mockCourseFindFirst.mockResolvedValue({
      nativeLang: 'en',
      targetLang: 'de',
      currentLevel: 'A1',
    });

    const res = await POST(jsonReq({ text: 'ich heiße' }), COURSE_PARAMS);

    expect(res.status).toBe(200);
    const systemPrompt = mockGenerateResponse.mock.calls[0][0] as string;
    expect(systemPrompt).toContain('A1 selection help');
    expect(systemPrompt).toContain('example sentence in the target language (de)');
    expect(systemPrompt).toContain('note in the source/native language (en)');
    expect(systemPrompt).toContain('A1 scaffolding');
  });

  it('400s on an empty selection', async () => {
    const res = await POST(jsonReq({ text: '' }), COURSE_PARAMS);

    expect(res.status).toBe(400);
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it('404s when the course does not belong to the learner', async () => {
    mockCourseFindFirst.mockResolvedValue(null);

    const res = await POST(jsonReq({ text: 'bonjour' }), COURSE_PARAMS);

    expect(res.status).toBe(404);
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });
});
