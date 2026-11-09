export interface RawGeneratedQuestion {
  targetIndex?: unknown;
  distractors?: unknown;
  taskContext?: unknown;
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
  passageRef?: unknown;
}

interface WrappedGeneratedQuestions {
  questions?: unknown;
  passage?: unknown;
}

export interface ParsedGeneratedQuestions {
  questions: RawGeneratedQuestion[];
  passage?: string;
}

export function sanitizeLlmJson(text: string): string {
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

export function parseGeneratedQuestions(content: string): ParsedGeneratedQuestions {
  const cleaned = sanitizeLlmJson(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = JSON.parse(extractFirstJsonValue(cleaned));
  }

  if (Array.isArray(parsed)) return { questions: parsed as RawGeneratedQuestion[] };
  if (parsed && typeof parsed === 'object') {
    const wrapped = parsed as WrappedGeneratedQuestions;
    if (Array.isArray(wrapped.questions)) {
      return {
        questions: wrapped.questions as RawGeneratedQuestion[],
        passage: typeof wrapped.passage === 'string' ? wrapped.passage : undefined,
      };
    }
  }

  throw new Error('Class generation returned no question array.');
}
