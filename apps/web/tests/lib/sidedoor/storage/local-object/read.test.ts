// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contentTypeForStorageKey,
  readLocalStorageFile,
} from '@/lib/storage/sidedoor/local-object-read';

describe('canonical local object reads', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sotto-local-object-'));
    file = join(directory, 'audio.mp3');
    await writeFile(file, '0123456789');
  });

  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('reads the complete attributed file with its media type', async () => {
    expect(await readLocalStorageFile(file, 'recordings/audio.mp3')).toEqual({
      body: Buffer.from('0123456789'),
      size: 10,
      contentType: 'audio/mpeg',
      start: 0,
      end: 9,
    });
  });

  it.each([
    ['bytes=2-5', '2345', 2, 5],
    ['bytes=7-', '789', 7, 9],
    ['bytes=-3', '789', 7, 9],
  ] as const)('reads range %s', async (range, body, start, end) => {
    expect(await readLocalStorageFile(file, 'recordings/audio.mp3', range)).toEqual({
      body: Buffer.from(body),
      size: 10,
      contentType: 'audio/mpeg',
      start,
      end,
    });
  });

  it.each(['bytes=99-200', 'items=0-1', 'bytes=-0'])(
    'rejects invalid or unsatisfied range %s',
    async (range) => {
      expect(await readLocalStorageFile(file, 'recordings/audio.mp3', range)).toBeNull();
    }
  );

  it('returns null for a missing attributed file', async () => {
    expect(await readLocalStorageFile(join(directory, 'missing'), 'missing.bin')).toBeNull();
  });

  it('maps supported extensions and defaults unknown content', () => {
    expect(contentTypeForStorageKey('notes.pdf')).toBe('application/pdf');
    expect(contentTypeForStorageKey('payload.bin')).toBe('application/octet-stream');
  });
});
