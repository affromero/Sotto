// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rename, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractMaterialText } from '@/lib/course-materials/extraction/runtime/text';

const directories: string[] = [];
const boundary = vi.hoisted(() => ({ afterStat: null as (() => Promise<void>) | null }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: async (...parameters: Parameters<typeof actual.lstat>) => {
      const metadata = await actual.lstat(...parameters);
      await boundary.afterStat?.();
      return metadata;
    },
    open: async (...parameters: Parameters<typeof actual.open>) => {
      const file = await actual.open(...parameters);
      const stat = file.stat.bind(file);
      Object.defineProperty(file, 'stat', {
        value: async () => {
          const metadata = await stat();
          await boundary.afterStat?.();
          return metadata;
        },
      });
      return file;
    },
  };
});
afterEach(async () => {
  boundary.afterStat = null;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'sotto-text-'));
  directories.push(directory);
  const path = join(directory, 'source.txt');
  await writeFile(path, bytes);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}
describe('complete original UTF-8 text extraction', () => {
  it('reads the validated original descriptor when the pathname changes before the read', async () => {
    const text = 'Complete original with the final sentence.';
    const file = await fixture(Buffer.from(text));
    boundary.afterStat = async () => {
      boundary.afterStat = null;
      await rename(file.path, `${file.path}.retained`);
      await writeFile(file.path, 'Different replacement content');
    };
    const result = await extractMaterialText(file.path, file.sha256, new AbortController().signal);
    expect([...result.chunks].map((chunk) => chunk.text).join('')).toBe(text);
    expect(result.manifest.textSha256).toBe(file.sha256);
    expect(await readFile(file.path, 'utf8')).toBe('Different replacement content');
  });
  it('rejects a symbolic-link original even when its target has the expected digest', async () => {
    const file = await fixture(Buffer.from('Complete original'));
    const link = `${file.path}.link`;
    await symlink(file.path, link);
    await expect(
      extractMaterialText(link, file.sha256, new AbortController().signal)
    ).rejects.toThrow();
    expect(await readFile(file.path, 'utf8')).toBe('Complete original');
  });
  it('retains BOM, NUL and the final content beyond a million characters', async () => {
    const text = '\uFEFF' + 'é 😀\u0000 '.repeat(180000) + 'FINAL_ORIGINAL_ENDING';
    const file = await fixture(Buffer.from(text));
    const result = await extractMaterialText(file.path, file.sha256, new AbortController().signal);
    expect([...result.chunks].map((chunk) => chunk.text).join('')).toBe(text);
    expect(result.manifest.textSha256).toBe(file.sha256);
    expect(result.manifest.codePointLength).toBeGreaterThan(1000000);
  });
  it('rejects invalid UTF-8 and a changed original digest', async () => {
    const malformed = await fixture(Buffer.from([0xff, 0xfe, 0xff]));
    await expect(
      extractMaterialText(malformed.path, malformed.sha256, new AbortController().signal)
    ).rejects.toThrow();
    const file = await fixture(Buffer.from('Complete original'));
    await expect(
      extractMaterialText(file.path, '0'.repeat(64), new AbortController().signal)
    ).rejects.toThrow(/checksum/);
  });
  it('reports its explicit processing byte limit without reading or truncating the original', async () => {
    const file = await fixture(Buffer.from('Original'));
    await truncate(file.path, 64 * 1024 * 1024 + 1);
    await expect(
      extractMaterialText(file.path, file.sha256, new AbortController().signal)
    ).rejects.toThrow(/budget/);
  });
});
