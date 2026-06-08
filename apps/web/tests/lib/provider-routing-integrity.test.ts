/**
 * Provider Routing Integrity Tests
 *
 * Structural tests that read REAL source files from disk to ensure:
 *   1. No file imports directly from llm.ts (hardcoded Anthropic) outside an allowlist
 *   2. No logUsage call hardcodes service: 'anthropic' outside an allowlist
 *   3. No resolveAiModelAndProvider call hardcodes provider: 'anthropic'
 *   4. No AI/TTS provider factory calls rely on default providers
 *
 * Pattern: tests/lib/prompt-integrity.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import glob from 'glob';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    // visual-classifier always uses Claude Haiku for batch segment classification
    'lib/visual-classifier.ts',
  ]);

  const STATIC_IMPORT_RE = /from\s+['"]([@./]*lib\/llm|\.\/llm|\.\.\/llm)['"]/;
  const DYNAMIC_IMPORT_RE = /import\(\s*['"].*\/llm['"]\s*\)/;

  it('no static or dynamic imports of llm.ts outside allowlist', () => {
    const allTs = glob.sync('**/*.ts', { cwd: SRC_DIR, ignore: ['**/*.d.ts', '**/*.test.ts'] });
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
  // The discovery route uses a type cast (runtime value is correct).
  const SERVICE_ALLOWLIST = new Set([
    'lib/transcript-parser.ts',
    'lib/reference-verification/ai-layer.ts',
    'lib/reference-verification/grounding.ts',
    'lib/import-metadata-generator.ts',
    'app/api/discovery/route.ts',
    // visual-classification always uses Anthropic Claude for batch classification
    'workers/visual-classification.worker.ts',
  ]);

  // Matches lines containing both `service:` and the literal `'anthropic'`
  const SERVICE_ANTHROPIC_RE = /service:\s*.*['"]anthropic['"]/;

  it('no logUsage calls with hardcoded anthropic service outside allowlist', () => {
    const allTs = glob.sync('**/*.ts', { cwd: SRC_DIR, ignore: ['**/*.d.ts', '**/*.test.ts'] });
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
    const allTs = glob.sync('**/*.ts', {
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

// ── Test 4: No provider factory defaults ───────────────────────

describe('no implicit AI or TTS provider factory defaults', () => {
  const FACTORY_DEFAULT_RE = /\bcreate(?:AI|Tts)Provider\(\s*\)/;
  const OPTIONAL_FACTORY_SIGNATURE_RE = /function\s+create(?:AI|Tts)Provider\s*\(\s*type\?/;

  it('no source file calls provider factories without an explicit provider', () => {
    const allTs = glob.sync('**/*.ts', { cwd: SRC_DIR, ignore: ['**/*.d.ts', '**/*.test.ts'] });
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of allTs) {
      const { content } = readSrc(join(SRC_DIR, file));
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (FACTORY_DEFAULT_RE.test(lines[i]) || OPTIONAL_FACTORY_SIGNATURE_RE.test(lines[i])) {
          violations.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    expect(violations, [
      'These files rely on implicit AI/TTS provider defaults.',
      'Fix: pass an explicit provider resolved from user/project config.',
      'Violations:',
      ...violations.map((v) => `  - ${v.file}:${v.line}: ${v.text}`),
    ].join('\n')).toEqual([]);
  });
});

// ── Test 5: provider-display.ts stays in sync with ai-registry.ts ──

describe('provider-display.ts stays in sync with ai-registry.ts', () => {
  const registryPath = join(__dirname, '../../src/lib/providers/ai-registry.ts');
  const displayPath = join(__dirname, '../../../../packages/shared/src/provider-display.ts');
  const registryContent = readFileSync(registryPath, 'utf-8');
  const displayContent = readFileSync(displayPath, 'utf-8');

  it('AI_PROVIDER_DISPLAY has entries for all AI provider IDs', () => {
    // Extract provider IDs from AiProviderId type union
    const typeMatch = registryContent.match(/type AiProviderId\s*=\s*([^;]+)/);
    const registryIds = typeMatch?.[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) ?? [];

    // Extract top-level keys from AI_PROVIDER_DISPLAY (lines matching `  key:` or `  'key':`)
    const displayLines = displayContent.split('\n');
    const startIdx = displayLines.findIndex(l => l.includes('AI_PROVIDER_DISPLAY'));
    const displayIds: string[] = [];
    for (let i = startIdx + 1; i < displayLines.length; i++) {
      if (displayLines[i].includes('};')) break;
      const m = displayLines[i].match(/^\s+['"]?([\w-]+)['"]?\s*:/);
      if (m) displayIds.push(m[1]);
    }

    const missing = registryIds.filter(id => !displayIds.includes(id));
    expect(missing, `AI_PROVIDER_DISPLAY is missing entries for: ${missing.join(', ')}`).toEqual([]);
  });

  it('AI_MODEL_DISPLAY has entries for all registered LLM models', () => {
    // Extract model IDs from the registry's models arrays
    // Match lines like: { id: 'claude-haiku-4-5-20251001', displayName: ...
    // But NOT provider-level id: 'anthropic' lines (those lack displayName on same line after a comma)
    const modelIds: string[] = [];
    const lines = registryContent.split('\n');
    for (const line of lines) {
      // Model entries have: id: 'xxx', displayName: 'yyy' on the same line
      const m = line.match(/\{\s*id:\s*'([^']+)',\s*displayName:/);
      if (m) modelIds.push(m[1]);
    }

    // Extract keys from AI_MODEL_DISPLAY
    const displayLines = displayContent.split('\n');
    const modelStartIdx = displayLines.findIndex(l => /^export const AI_MODEL_DISPLAY/.test(l));
    const displayModelIds: string[] = [];
    for (let i = modelStartIdx + 1; i < displayLines.length; i++) {
      if (displayLines[i].includes('};')) break;
      const m = displayLines[i].match(/^\s+['"]([^'"]+)['"]\s*:/);
      if (m) displayModelIds.push(m[1]);
    }

    // Claude-code models use composite keys like 'claude-code:haiku' in display
    const ccModels = new Set(['haiku', 'sonnet', 'opus']);
    const missingDirect = modelIds.filter(id => !ccModels.has(id) && !displayModelIds.includes(id));
    const missingCC = modelIds.filter(id => ccModels.has(id) && !displayModelIds.includes(`claude-code:${id}`));
    const missing = [...missingDirect, ...missingCC.map(id => `claude-code:${id}`)];

    expect(missing, `AI_MODEL_DISPLAY is missing entries for: ${missing.join(', ')}`).toEqual([]);
  });
});

// ── Test 6: Pricing derivation sanity ──────────────────────────

import { getAllAiProviderMeta } from '@/lib/providers/ai-registry';
import { getAiPricing } from '@/lib/pricing';

describe('pricing coverage', () => {
  it('every registry model with pricing has a matching entry in getAiPricing()', () => {
    for (const provider of getAllAiProviderMeta()) {
      for (const model of provider.models) {
        if (model.pricing) {
          const pricing = getAiPricing(model.id);
          expect(pricing.inputPerMTok, `${model.id} inputPerMTok mismatch`).toBe(model.pricing.inputPerMTok);
          expect(pricing.outputPerMTok, `${model.id} outputPerMTok mismatch`).toBe(model.pricing.outputPerMTok);
        }
      }
    }
  });
});
