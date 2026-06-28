import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { classLanguagePolicy } from '@/lib/classes/class-language-policy';
import { resolveLearningAi } from '@/lib/learning-ai';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { createAIProvider } from '@/lib/providers/ai';
import { logUsage } from '@/lib/usage-logger';

type RouteParams = { params: Promise<{ courseId: string }> };

const selectionHelpSchema = z.object({
  text: z.string().trim().min(1).max(500),
  contextText: z.string().trim().max(2000).nullable().optional(),
});

interface RawSelectionExample {
  sentence?: unknown;
  note?: unknown;
}

function sanitizeLlmJson(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

function extractFirstJsonValue(text: string): string {
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error('No JSON object or array found in response');

  const start = Math.min(...starts);
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      stack.push('}');
      continue;
    }
    if (ch === '[') {
      stack.push(']');
      continue;
    }
    if (stack.length > 0 && ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }

  throw new Error('Unbalanced JSON response');
}

function parseExamples(content: string): Array<{ sentence: string; note: string }> {
  const cleaned = sanitizeLlmJson(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = JSON.parse(extractFirstJsonValue(cleaned));
  }

  const examples: RawSelectionExample[] = Array.isArray(parsed)
    ? (parsed as RawSelectionExample[])
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { examples?: unknown }).examples)
      ? (parsed as { examples: RawSelectionExample[] }).examples
      : [];
  return examples
    .filter((example) => typeof example.sentence === 'string' && typeof example.note === 'string')
    .map((example) => ({
      sentence: example.sentence as string,
      note: example.note as string,
    }))
    .slice(0, 3);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const { courseId } = await params;
    const parsed = selectionHelpSchema.safeParse(await request.json());
    if (!parsed.success) return errorResponse('Invalid selection', 400);

    const course = await prisma.course.findFirst({
      where: { id: courseId, userId: authed.userId },
      select: { nativeLang: true, targetLang: true, currentLevel: true },
    });
    if (!course) return errorResponse('Course not found', 404);

    const ai = await resolveLearningAi(authed.userId);
    const provider = createAIProvider(ai.provider);
    const languagePolicy = classLanguagePolicy({
      level: course.currentLevel,
      nativeLang: course.nativeLang,
      targetLang: course.targetLang,
    });
    const isA1 = course.currentLevel.toUpperCase() === 'A1';
    const exampleLanguageGuidance = isA1
      ? [
          `A1 selection help: put each example sentence in the target language (${course.targetLang}).`,
          `Put each note in the source/native language (${course.nativeLang}) as a simple meaning, hint, or usage explanation.`,
          'This is allowed A1 scaffolding, but the sentence itself must still exercise the target language.',
        ].join(' ')
      : [
          `Immersion selection help: put both each sentence and each note in the target language (${course.targetLang}).`,
          `Do not use the source/native language (${course.nativeLang}) in the examples or notes.`,
        ].join(' ');

    const system = [
      'You are a language-class helper for a learner who selected text they do not understand.',
      'Do not return a raw translation.',
      'Return exactly three short, easy examples that use the selected text naturally.',
      'Use simple words and everyday contexts.',
      'Keep each sentence concise and level-appropriate.',
      exampleLanguageGuidance,
      'The learner-visible sentence and note must follow this policy:',
      languagePolicy,
      'Return JSON only.',
    ].join('\n');

    const context = parsed.data.contextText
      ? `\nContext from the class:\n${parsed.data.contextText}`
      : '';
    const response = await provider.generateResponse(
      system,
      [
        {
          role: 'user',
          content: `Selected text: ${parsed.data.text}${context}\n\nReturn exactly three examples.`,
        },
      ],
      {
        model: ai.model,
        apiKeyOverride: ai.apiKey,
        maxTokens: 1200,
        temperature: 0.4,
      }
    );

    logUsage({
      service: ai.provider,
      model: response.model,
      category: 'selection-help',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      userId: authed.userId,
    });

    const examples = parseExamples(response.content);
    if (examples.length !== 3) {
      logger.warn('Selection help returned unusable examples', {
        courseId,
        count: String(examples.length),
      });
      return errorResponse(
        'Could not build examples for that selection. Try a shorter phrase.',
        422
      );
    }

    return NextResponse.json({ text: parsed.data.text, examples });
  } catch (error: unknown) {
    logger.error('Failed to generate selection help', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Selection help is unavailable right now.', 500);
  }
}
