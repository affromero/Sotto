// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractMaterialText } from '@/lib/course-materials/extraction/runtime/text';

const directories: string[] = [];
afterEach(async () => {
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
