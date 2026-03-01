/**
 * Provider Routing Integrity Tests
 *
 * Structural tests that read REAL source files from disk to ensure:
 *   1. No file imports directly from llm.ts (hardcoded Anthropic) outside an allowlist
 *   2. No logUsage call hardcodes service: 'anthropic' outside an allowlist
 *   3. No resolveAiModelAndProvider call hardcodes provider: 'anthropic'
 *
 * Pattern: tests/lib/prompt-integrity.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { globSync } from 'glob';

const SRC_DIR = join(__dirname, '../../src');

/** Read a source file and return its content with the relative path from src/. */
function readSrc(absPath: string): { rel: string; content: string } {
  return {
    rel: relative(SRC_DIR, absPath),
    content: readFileSync(absPath, 'utf-8'),
  };
}

// ── Test 1: No llm.ts imports outside allowlist ───────────────

describe('no direct llm.ts imports outside allowlist', () => {
  // These files are the ONLY ones allowed to import from llm.ts.
  const LLM_IMPORT_ALLOWLIST = new Set([
    // discovery-agent uses Anthropic streaming (streamResponse + generateResponse
    // with onComplete callback for token tracking)
    'lib/discovery-agent.ts',
    // AnthropicProvider wraps llm.ts via dynamic import('../llm') — this IS the provider system
    'lib/providers/ai.ts',
  ]);

  const STATIC_IMPORT_RE = /from\s+['"]([@./]*lib\/llm|\.\/llm|\.\.\/llm)['"]/;
  const DYNAMIC_IMPORT_RE = /import\(\s*['"].*\/llm['"]\s*\)/;

  it('no static or dynamic imports of llm.ts outside allowlist', () => {
    const allTs = globSync('**/*.ts', { cwd: SRC_DIR, ignore: ['**/*.d.ts', '**/*.test.ts'] });
    const violations: string[] = [];

    for (const file of allTs) {
      if (LLM_IMPORT_ALLOWLIST.has(file)) continue;

      const { content } = readSrc(join(SRC_DIR, file));
      if (STATIC_IMPORT_RE.test(content) || DYNAMIC_IMPORT_RE.test(content)) {
        violations.push(file);
      }
    }

    expect(violations, [
      'These files import from llm.ts (hardcoded Anthropic SDK) instead of using the provider system.',
      'Fix: replace `import { generateResponse } from \'./llm\'` with `import { createAIProvider } from \'./providers/ai\'`',
      'Violations:',
      ...violations.map((f) => `  - ${f}`),
    ].join('\n')).toEqual([]);
  });
});

// ── Test 2: No hardcoded 'anthropic' in logUsage service: fields ──

describe('no hardcoded anthropic in logUsage service fields', () => {
  // Defensive ?? 'anthropic' fallbacks — unreachable after provider routing fix, but harmless.
  // The discovery route uses a type cast (runtime value is correct).
  const SERVICE_ALLOWLIST = new Set([
    'lib/transcript-parser.ts',
    'lib/reference-verification/ai-layer.ts',
    'lib/import-metadata-generator.ts',
    'app/api/discovery/route.ts',
  ]);

  // Matches lines containing both `service:` and the literal `'anthropic'`
  const SERVICE_ANTHROPIC_RE = /service:\s*.*['"]anthropic['"]/;

  it('no logUsage calls with hardcoded anthropic service outside allowlist', () => {
    const allTs = globSync('**/*.ts', { cwd: SRC_DIR, ignore: ['**/*.d.ts', '**/*.test.ts'] });
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of allTs) {
      if (SERVICE_ALLOWLIST.has(file)) continue;

      const { content } = readSrc(join(SRC_DIR, file));
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (SERVICE_ANTHROPIC_RE.test(lines[i])) {
          violations.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    expect(violations, [
      'These files hardcode service: \'anthropic\' in logUsage calls.',
      'Fix: pass the resolved provider string instead.',
      'Violations:',
      ...violations.map((v) => `  - ${v.file}:${v.line}: ${v.text}`),
    ].join('\n')).toEqual([]);
  });
});

// ── Test 3: No hardcoded provider: 'anthropic' in AI calls ────

describe('no hardcoded provider anthropic in AI resolution calls', () => {
  // The provider system itself is allowed to reference 'anthropic' as a provider value.
  const PROVIDER_ALLOWLIST = new Set([
    'lib/providers/ai.ts',
    'lib/providers/ai-registry.ts',
  ]);

  const PROVIDER_ANTHROPIC_RE = /provider:\s*['"]anthropic['"]/;

  it('no hardcoded provider: \'anthropic\' in source files outside providers/', () => {
    const allTs = globSync('**/*.ts', {
      cwd: SRC_DIR,
      ignore: ['**/*.d.ts', '**/*.test.ts'],
    });
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of allTs) {
      if (PROVIDER_ALLOWLIST.has(file)) continue;

      const { content } = readSrc(join(SRC_DIR, file));
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (PROVIDER_ANTHROPIC_RE.test(lines[i])) {
          violations.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    expect(violations, [
      'These files hardcode provider: \'anthropic\' instead of using resolved provider values.',
      'Violations:',
      ...violations.map((v) => `  - ${v.file}:${v.line}: ${v.text}`),
    ].join('\n')).toEqual([]);
  });
});
