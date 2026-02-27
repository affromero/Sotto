import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { render, loadPrompt, loadAndRender } from '../../src/lib/prompt-loader';

// Mock fs — vi.mock is hoisted above imports. CJS modules need a `default` re-export.
vi.mock(import('fs'), async (importOriginal) => {
  const actual = await importOriginal();
  const mock = { ...actual, readFileSync: vi.fn() };
  return { ...mock, default: mock };
});

const mockReadFileSync = vi.mocked(readFileSync);

// Use unique file paths per test to avoid cache contamination
// (the module-level Map persists across tests in the same import)
let testId = 0;
function uniquePath(base: string): string {
  return `test-${++testId}-${base}`;
}

beforeEach(() => {
  mockReadFileSync.mockReset();
});

// ── render() ──────────────────────────────────────────────────

describe('render', () => {
  it('replaces single placeholder', () => {
    expect(render('Hello {{NAME}}!', { NAME: 'Sotto' })).toBe('Hello Sotto!');
  });

  it('replaces multiple different placeholders', () => {
    const result = render('{{A}} and {{B}}', { A: 'one', B: 'two' });
    expect(result).toBe('one and two');
  });

  it('replaces repeated placeholders', () => {
    const result = render('{{X}} then {{X}} again', { X: 'val' });
    expect(result).toBe('val then val again');
  });

  it('collapses unrecognized placeholders to empty string', () => {
    expect(render('before {{MISSING}} after', {})).toBe('before  after');
  });

  it('handles empty string values', () => {
    expect(render('a{{B}}c', { B: '' })).toBe('ac');
  });

  it('handles multiline values', () => {
    const multiline = 'line1\nline2\nline3';
    expect(render('start\n{{BLOCK}}\nend', { BLOCK: multiline })).toBe(
      'start\nline1\nline2\nline3\nend'
    );
  });

  it('handles values containing curly braces (non-placeholder patterns)', () => {
    expect(render('{{CODE}}', { CODE: 'const x = {a: 1}' })).toBe('const x = {a: 1}');
  });

  it('does not replace partial patterns like {SINGLE} or {{ SPACED }}', () => {
    const template = '{SINGLE} and {{ SPACED }} and {{VALID}}';
    expect(render(template, { VALID: 'ok' })).toBe('{SINGLE} and {{ SPACED }} and ok');
  });

  it('handles template with no placeholders', () => {
    expect(render('plain text', {})).toBe('plain text');
  });

  it('handles empty template', () => {
    expect(render('', { A: 'val' })).toBe('');
  });

  it('handles underscore and digit variable names', () => {
    expect(render('{{WORD_COUNT_MIN}} to {{COUNT2}}', {
      WORD_COUNT_MIN: '100',
      COUNT2: '200',
    })).toBe('100 to 200');
  });
});

// ── loadPrompt() ──────────────────────────────────────────────

describe('loadPrompt', () => {
  it('reads file from prompts directory with utf-8 encoding', () => {
    mockReadFileSync.mockReturnValue('template content');
    const path = uniquePath('safety.md');
    const result = loadPrompt(path);
    expect(result).toBe('template content');
    expect(mockReadFileSync).toHaveBeenCalledOnce();
    expect(String(mockReadFileSync.mock.calls[0][0])).toContain('prompts');
    expect(String(mockReadFileSync.mock.calls[0][0])).toContain(path);
    expect(mockReadFileSync.mock.calls[0][1]).toBe('utf-8');
  });

  it('caches after first read', () => {
    const path = uniquePath('cached.md');
    mockReadFileSync.mockReturnValue('cached content');
    const first = loadPrompt(path);
    const second = loadPrompt(path);
    expect(first).toBe('cached content');
    expect(second).toBe('cached content');
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });

  it('caches different paths independently', () => {
    const pathA = uniquePath('a.md');
    const pathB = uniquePath('b.md');
    mockReadFileSync.mockReturnValueOnce('file A').mockReturnValueOnce('file B');
    const a = loadPrompt(pathA);
    const b = loadPrompt(pathB);
    expect(a).toBe('file A');
    expect(b).toBe('file B');
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  it('throws when file does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    expect(() => loadPrompt(uniquePath('nonexistent.md'))).toThrow('ENOENT');
  });
});

// ── loadAndRender() ───────────────────────────────────────────

describe('loadAndRender', () => {
  it('loads and renders in one call', () => {
    const path = uniquePath('greet.md');
    mockReadFileSync.mockReturnValue('Hello {{WHO}}!');
    expect(loadAndRender(path, { WHO: 'world' })).toBe('Hello world!');
  });

  it('uses cached template on second call with different vars', () => {
    const path = uniquePath('tpl.md');
    mockReadFileSync.mockReturnValue('{{A}} {{B}}');
    loadAndRender(path, { A: '1', B: '2' });
    const result = loadAndRender(path, { A: '3', B: '4' });
    expect(result).toBe('3 4');
    expect(mockReadFileSync).toHaveBeenCalledOnce();
  });

  it('collapses optional vars to empty when not provided', () => {
    const path = uniquePath('optional.md');
    mockReadFileSync.mockReturnValue('required: {{REQUIRED}}\noptional: {{OPTIONAL}}');
    const result = loadAndRender(path, { REQUIRED: 'yes' });
    expect(result).toBe('required: yes\noptional: ');
  });
});
