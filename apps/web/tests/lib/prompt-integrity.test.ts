/**
 * Prompt Integrity Tests
 *
 * Structural tests that verify the prompt .md files and their TypeScript consumers
 * stay in sync. These read REAL files from disk — they catch:
 *   - Missing or orphaned .md files
 *   - Variable contract drift ({{VAR}} in .md without matching loadAndRender key)
 *   - Empty or malformed prompt files
 *   - Shared fragments containing expected safety/realism content
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';

const PROMPTS_DIR = join(__dirname, '../../prompts');

// ── Helper ────────────────────────────────────────────────────

/** Extract all {{VAR}} placeholder names from a template string. */
function extractPlaceholders(content: string): string[] {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

// ── All expected .md files ────────────────────────────────────

const EXPECTED_FILES = [
  'shared/content-safety.md',
  'shared/input-sanitization.md',
  'shared/voice-realism-full.md',
  'shared/voice-realism-short.md',
  'shared/audience/kids.md',
  'shared/audience/teens.md',
  'shared/audience/family.md',
  'shared/audience/general.md',
  'shared/audience/mature.md',
  'shared/bias-guidance.md',
  'discovery/agent.md',
  'discovery/fallback.md',
  'topic-assessor.md',
  'credential-lookup.md',
  'import/import-metadata.md',
  'import/transcript-diarization.md',
  'social/telegram-parser.md',
  'social/tweet-parser.md',
  'social/thread-analyzer.md',
  'verification/reference-validator.md',
  'verification/reference-verification-ai.md',
  'verification/script-verifier-base.md',
  'verification/script-verifier-previous-feedback.md',
  'verification/script-verifier-incremental.md',
  'verification/script-verifier-output-format.md',
  'interaction/qa-assistant.md',
  'interaction/incorporate-segment.md',
  'generation/script-generator.md',
  'generation/monologue-guidelines.md',
  'generation/dialogue-guidelines.md',
  'generation/eli5-section.md',
  'generation/script-revision-factcheck.md',
  'generation/script-revision-user.md',
  'feeds/taste-quiz.md',
  'feeds/for-you.md',
  'feeds/curiosity.md',
  'feeds/news.md',
  'feeds/news-from-newsletters.md',
  'audio/voice-assigner.md',
  'audio/tts-tag-converter.md',
  'pricing-extractor.md',
];

// ── Variable contracts: template → expected placeholder names ──
// Each entry documents which {{VAR}} placeholders a template MUST contain.
// If a .md file gains or loses a placeholder, these tests will catch it.

const VARIABLE_CONTRACTS: Record<string, string[]> = {
  'generation/script-generator.md': [
    'AUDIENCE', 'AUDIENCE_GUIDANCE', 'BIAS_GUIDANCE', 'CONTENT_SAFETY', 'DURATION_TARGET',
    'ELI5_SECTION', 'EXPERT_SPEAKER', 'FOCUS_AREAS', 'HOST_SPEAKER',
    'SPEAKER_COUNT', 'SPEAKER_SECTION', 'TONE_GUIDANCE',
    'VOICE_DELIVERY_GUIDELINES', 'VOICE_REALISM',
    'WORD_COUNT_IDEAL', 'WORD_COUNT_MAX', 'WORD_COUNT_MIN',
    'AUDIENCE_LEVEL',
  ].sort(),
  'generation/script-revision-factcheck.md': [
    'AUDIENCE', 'AUDIENCE_GUIDANCE', 'AUDIENCE_LEVEL', 'BIAS_GUIDANCE', 'CONTENT_SAFETY',
    'DURATION_TARGET', 'FOCUS_AREAS', 'SPEAKER_SECTION', 'TONE_GUIDANCE',
    'VOICE_REALISM', 'WORD_COUNT_IDEAL', 'WORD_COUNT_MAX', 'WORD_COUNT_MIN',
  ].sort(),
  'generation/script-revision-user.md': [
    'AUDIENCE', 'AUDIENCE_GUIDANCE', 'AUDIENCE_LEVEL', 'BIAS_GUIDANCE', 'CONTENT_SAFETY',
    'DURATION_TARGET', 'FOCUS_AREAS', 'SPEAKER_SECTION', 'TONE_GUIDANCE',
    'VOICE_REALISM', 'WORD_COUNT_IDEAL', 'WORD_COUNT_MAX', 'WORD_COUNT_MIN',
  ].sort(),
  'shared/bias-guidance.md': ['SOURCE_BIAS', 'SOURCE_NAME'].sort(),
  'interaction/qa-assistant.md': ['LANGUAGE_LABEL'],
  'interaction/incorporate-segment.md': ['ACTIVE_SPEAKER', 'LANGUAGE_LABEL'],
  'verification/script-verifier-base.md': ['AUDIENCE_LEVEL', 'ATTEMPT_NUMBER'].sort(),
  'verification/script-verifier-previous-feedback.md': ['PREVIOUS_FEEDBACK'],
  'verification/script-verifier-incremental.md': [
    'CARRIED_CLAIMS', 'CHANGED_LIST', 'UNCHANGED_INDICES',
  ].sort(),
  'feeds/taste-quiz.md': [
    'DISLIKED_SUMMARY', 'INTEREST_SUMMARY', 'RECENT_QUESTIONS',
    'REQUEST_COUNT', 'TAXONOMY',
  ].sort(),
  'feeds/for-you.md': [
    'INPUT_SANITIZATION', 'INTEREST_CONTEXT', 'REQUEST_COUNT',
    'TAXONOMY', 'TOPIC_CONTEXT',
  ].sort(),
  'feeds/curiosity.md': [
    'INPUT_SANITIZATION', 'REQUEST_COUNT', 'TAXONOMY', 'TOPIC_CONTEXT',
  ].sort(),
  'feeds/news.md': [
    'DIVERSITY_NOTE', 'EXCLUDE_CONTEXT', 'INPUT_SANITIZATION',
    'REQUEST_COUNT', 'TAXONOMY', 'TIME_LABEL', 'TOPIC_FOCUS',
  ].sort(),
  'feeds/news-from-newsletters.md': [
    'DIVERSITY_NOTE', 'EXCLUDE_CONTEXT', 'INPUT_SANITIZATION',
    'NEWSLETTER_ARTICLES', 'REQUEST_COUNT', 'TAXONOMY', 'TIME_LABEL', 'TOPIC_FOCUS',
  ].sort(),
  'audio/voice-assigner.md': [
    'SPEAKERS', 'SPEAKER_COUNT', 'VOICE_CATALOG',
  ].sort(),
  'audio/tts-tag-converter.md': [
    'PROVIDER_DOCS', 'PROVIDER_NAME', 'TURNS_JSON',
  ].sort(),
};

// Templates that are static (no placeholders)
const STATIC_TEMPLATES = EXPECTED_FILES.filter((f) => !VARIABLE_CONTRACTS[f]);

// ── Tests ─────────────────────────────────────────────────────

describe('prompt file existence', () => {
  it(`prompts directory contains exactly ${EXPECTED_FILES.length} .md files`, () => {
    const actual = globSync('**/*.md', { cwd: PROMPTS_DIR }).sort();
    expect(actual).toHaveLength(EXPECTED_FILES.length);
    expect(actual).toEqual(EXPECTED_FILES.sort());
  });

  it.each(EXPECTED_FILES)('%s exists and is non-empty', (file) => {
    const fullPath = join(PROMPTS_DIR, file);
    expect(existsSync(fullPath)).toBe(true);
    const content = readFileSync(fullPath, 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('no orphaned .md files outside expected set', () => {
    const actual = new Set(globSync('**/*.md', { cwd: PROMPTS_DIR }));
    const expected = new Set(EXPECTED_FILES);
    const orphaned = [...actual].filter((f) => !expected.has(f));
    expect(orphaned).toEqual([]);
  });
});

describe('variable contracts', () => {
  for (const [file, expectedVars] of Object.entries(VARIABLE_CONTRACTS)) {
    it(`${file} contains exactly the expected {{VAR}} placeholders`, () => {
      const content = readFileSync(join(PROMPTS_DIR, file), 'utf-8');
      const actualVars = extractPlaceholders(content);
      expect(actualVars).toEqual(expectedVars);
    });
  }
});

describe('static templates have no placeholders', () => {
  it.each(STATIC_TEMPLATES)('%s contains no {{VAR}} placeholders', (file) => {
    const content = readFileSync(join(PROMPTS_DIR, file), 'utf-8');
    const vars = extractPlaceholders(content);
    expect(vars).toEqual([]);
  });
});

describe('shared fragment content', () => {
  it('content-safety.md contains safety instructions', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'shared/content-safety.md'), 'utf-8');
    expect(content).toContain('Content Safety');
    expect(content).toContain('must refuse');
  });

  it('input-sanitization.md contains injection defense', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'shared/input-sanitization.md'), 'utf-8');
    expect(content).toContain('Input Handling');
    expect(content).toContain('override attempts');
  });

  it('voice-realism-full.md contains speech guidance', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'shared/voice-realism-full.md'), 'utf-8');
    expect(content).toContain('disfluenc');
    expect(content.length).toBeGreaterThan(500);
  });

  it('voice-realism-short.md is shorter than full version', () => {
    const full = readFileSync(join(PROMPTS_DIR, 'shared/voice-realism-full.md'), 'utf-8');
    const short = readFileSync(join(PROMPTS_DIR, 'shared/voice-realism-short.md'), 'utf-8');
    expect(short.length).toBeLessThan(full.length);
  });

  it('all 5 audience files exist and contain guidance', () => {
    for (const audience of ['kids', 'teens', 'family', 'general', 'mature']) {
      const content = readFileSync(join(PROMPTS_DIR, `shared/audience/${audience}.md`), 'utf-8');
      expect(content.trim().length).toBeGreaterThan(10);
    }
  });

  it('mature audience guidance sets boundaries', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'shared/audience/mature.md'), 'utf-8');
    // Should allow frank discussion but draw safety lines
    expect(content.toLowerCase()).toMatch(/frank|adult|mature/);
  });
});

describe('generation templates', () => {
  it('script-generator.md references JSON output format', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'generation/script-generator.md'), 'utf-8');
    expect(content).toContain('"speaker"');
    expect(content).toContain('"text"');
    expect(content).toContain('JSON');
  });

  it('monologue and dialogue guidelines are mutually exclusive content', () => {
    const mono = readFileSync(join(PROMPTS_DIR, 'generation/monologue-guidelines.md'), 'utf-8');
    const dial = readFileSync(join(PROMPTS_DIR, 'generation/dialogue-guidelines.md'), 'utf-8');
    expect(mono.toLowerCase()).toContain('monologue');
    expect(dial.toLowerCase()).toContain('dialogue');
    // They shouldn't be identical
    expect(mono).not.toBe(dial);
  });

  it('eli5-section.md contains ELI5 specific instructions', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'generation/eli5-section.md'), 'utf-8');
    expect(content.toLowerCase()).toMatch(/eli5|explain.*(like|simple)|five.year/i);
  });

  it('revision templates reference original script', () => {
    for (const file of ['generation/script-revision-factcheck.md', 'generation/script-revision-user.md']) {
      const content = readFileSync(join(PROMPTS_DIR, file), 'utf-8');
      expect(content.toLowerCase()).toContain('revis');
    }
  });
});

describe('verification templates', () => {
  it('script-verifier parts concatenate into a coherent prompt', () => {
    const base = readFileSync(join(PROMPTS_DIR, 'verification/script-verifier-base.md'), 'utf-8');
    const output = readFileSync(join(PROMPTS_DIR, 'verification/script-verifier-output-format.md'), 'utf-8');
    // Base should set up the task
    expect(base.toLowerCase()).toContain('verif');
    // Output format should describe the JSON response structure
    expect(output).toContain('JSON');
  });

  it('incremental verifier references pre-verified turns', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'verification/script-verifier-incremental.md'), 'utf-8');
    expect(content).toContain('Pre-verified');
    expect(content).toContain('{{UNCHANGED_INDICES}}');
  });
});

describe('feed templates', () => {
  it('all feed templates produce JSON array output', () => {
    for (const file of ['feeds/taste-quiz.md', 'feeds/for-you.md', 'feeds/curiosity.md', 'feeds/news.md']) {
      const content = readFileSync(join(PROMPTS_DIR, file), 'utf-8');
      expect(content).toContain('JSON array');
      expect(content).toContain('"text"');
      expect(content).toContain('"tagSlugs"');
    }
  });

  it('news.md includes web search instruction', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'feeds/news.md'), 'utf-8');
    expect(content.toLowerCase()).toContain('search the web');
  });

  it('curiosity.md explicitly avoids personalization', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'feeds/curiosity.md'), 'utf-8');
    expect(content).toContain('Do NOT personalize');
  });

  it('for-you.md emphasizes creative combinations', () => {
    const content = readFileSync(join(PROMPTS_DIR, 'feeds/for-you.md'), 'utf-8');
    expect(content).toContain('CREATIVE COMBINATIONS');
  });
});
