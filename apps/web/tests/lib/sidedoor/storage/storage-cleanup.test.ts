// @vitest-environment node
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureStorageBackend, captureStorageCleanup, restoreStorageBackend } from '@/lib/r2';
import { getServerInfra } from '@/lib/server-config';

const database = vi.hoisted(() => ({ failed: false, provider: 'local', root: '' }));
vi.mock('@/lib/site-config', () => ({
  getSiteConfig: async () => {
    if (database.failed) throw new Error('Configuration database unavailable');
    return {
      aiProvider: null,
      aiModel: null,
      aiBaseUrl: null,
      liveModel: null,
      sttProvider: null,
      sttBaseUrl: null,
      sttModel: null,
      ttsProvider: null,
      ttsBaseUrl: null,
      ttsVoices: null,
      storageProvider: database.provider,
      localStorageRoot: database.root,
      objectStorageEndpoint: null,
      objectStorageBucket: null,
      objectStorageRegion: null,
      objectStoragePublicUrl: null,
    };
  },
}));

const directories: string[] = [];
beforeEach(() => {
  database.failed = false;
  database.provider = 'local';
});
afterEach(async () => {
  database.failed = false;
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-'));
  directories.push(root);
  database.root = root;
  await mkdir(join(root, 'episodes', 'owned'), { recursive: true });
  await writeFile(join(root, 'episodes', 'owned', 'audio.mp3'), 'original');
  return root;
}

describe('captured Sotto cleanup backend', () => {
  it('preserves local bytes when cleanup is cancelled before dispatch', async () => {
    const root = await fixture();
    const backend = await captureStorageBackend();
    const reason = new Error('Cleanup cancelled');
    const signal = AbortSignal.abort(reason);
    await expect(backend.has('episodes/owned/audio.mp3', signal)).rejects.toBe(reason);
    await expect(backend.delete('episodes/owned/audio.mp3', { force: true, signal })).rejects.toBe(
      reason
    );
    expect(await readFile(join(root, 'episodes/owned/audio.mp3'), 'utf8')).toBe('original');
  });
  it('reads exact local bytes from the captured root after configuration changes', async () => {
    const root = await fixture();
    const backend = await captureStorageBackend();
    const replacement = await fixture();
    await writeFile(join(replacement, 'episodes/owned/audio.mp3'), 'different backend');
    const destination = join(root, 'download.mp3');
    await backend.downloadToFile('/api/v1/storage/episodes/owned/audio.mp3', destination);
    expect(await readFile(destination, 'utf8')).toBe('original');
    await expect(backend.downloadToFile('../escape', join(root, 'escaped'))).rejects.toThrow();
  });
  it('streams into the captured root and owns sources even when preflight fails', async () => {
    const root = await fixture();
    const backend = await captureStorageBackend();
    await fixture();
    const source = Readable.from(['first ', 'second']);
    const url = await backend.writeStream('recordings/unique.wav', source, 'audio/wav');
    expect(url).toBe('/api/v1/storage/recordings/unique.wav');
    expect(await readFile(join(root, 'recordings/unique.wav'), 'utf8')).toBe('first second');
    expect(source.destroyed).toBe(true);
    const cancelled = Readable.from(['never written']);
    await expect(
      backend.writeStream('recordings/cancelled.wav', cancelled, 'audio/wav', AbortSignal.abort())
    ).rejects.toMatchObject({ created: false, cause: { name: 'AbortError' } });
    expect(cancelled.destroyed).toBe(true);
    expect(await backend.has('recordings/cancelled.wav')).toBe(false);
  });
  it('writes to the admitted root after configuration changes and never replaces an existing file', async () => {
    const original = await fixture();
    const backend = await captureStorageBackend();
    const replacement = await fixture();
    const key = 'avatars/owner/unique.png';
    expect(await backend.writeBuffer(key, Buffer.from('avatar'), 'image/png')).toBe(
      `/api/v1/storage/${key}`
    );
    expect(await readFile(join(original, key), 'utf8')).toBe('avatar');
    await expect(readFile(join(replacement, key))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      backend.writeBuffer(key, Buffer.from('replacement'), 'image/png')
    ).rejects.toMatchObject({
      created: false,
      cause: { code: 'EEXIST' },
    });
    expect(await readFile(join(original, key), 'utf8')).toBe('avatar');
    await backend.delete(key);
    expect(await backend.has(key)).toBe(false);
  });
  it('restores cleanup to its original directory after the configured root changes', async () => {
    const root = await fixture();
    const cleanup = await captureStorageCleanup();
    const descriptor = structuredClone(cleanup.descriptor);
    const replacement = await fixture();
    const keys: string[] = [];
    for await (const key of cleanup.list('episodes/owned/')) keys.push(key);
    expect(keys).toEqual(['episodes/owned/audio.mp3']);
    expect(await cleanup.has(keys[0]!)).toBe(true);
    await expect(cleanup.delete(keys[0]!)).rejects.toThrow('explicit force');
    await cleanup.delete(keys[0]!, { force: true });
    expect(await cleanup.has(keys[0]!)).toBe(false);
    await expect(readFile(join(root, keys[0]!))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(replacement, keys[0]!), 'utf8')).toBe('original');
    await expect(captureStorageBackend(descriptor)).rejects.toThrow('backend changed');
    const restored = await captureStorageCleanup(descriptor);
    await restored.delete(keys[0]!, { force: true });
    expect(await readFile(join(replacement, keys[0]!), 'utf8')).toBe('original');
  });

  it.each(['local', 's3'])(
    'restores historical reads and cleanup after switching to %s without current configuration',
    async (provider) => {
      const root = await fixture();
      const original = await captureStorageBackend();
      const replacement = await fixture();
      await writeFile(join(replacement, 'episodes/owned/audio.mp3'), 'replacement');
      database.provider = provider;
      database.failed = true;
      const restored = await restoreStorageBackend(structuredClone(original.descriptor));
      const destination = join(replacement, 'historical.mp3');
      await restored.downloadToFile('/api/v1/storage/episodes/owned/audio.mp3', destination);
      expect(await readFile(destination, 'utf8')).toBe('original');
      expect('writeBuffer' in restored).toBe(false);
      expect('writeStream' in restored).toBe(false);
      await expect(restored.delete('episodes/owned/audio.mp3')).rejects.toThrow('explicit force');
      await restored.delete('episodes/owned/audio.mp3', { force: true });
      await expect(readFile(join(root, 'episodes/owned/audio.mp3'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(join(replacement, 'episodes/owned/audio.mp3'), 'utf8')).toBe(
        'replacement'
      );
    }
  );

  it.each(['missing', 'replaced'])(
    'rejects a %s historical directory without using the current root',
    async (state) => {
      const root = await fixture();
      const original = await captureStorageBackend();
      const replacement = await fixture();
      const moved = `${root}-retired`;
      directories.push(moved);
      await rename(root, moved);
      if (state === 'replaced') await mkdir(root);
      await expect(restoreStorageBackend(original.descriptor)).rejects.toThrow();
      expect(await readFile(join(replacement, 'episodes/owned/audio.mp3'), 'utf8')).toBe(
        'original'
      );
      if (state === 'missing')
        await expect(readFile(root)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  );

  it('accepts authenticated local routes and rejects direct file references', async () => {
    await fixture();
    const cleanup = await captureStorageCleanup();
    expect(cleanup.normalize('/api/v1/storage/recordings/hello%20world.wav')).toBe(
      'recordings/hello world.wav'
    );
    expect(() => cleanup.normalize('file:///tmp/episodes/owned/audio.mp3')).toThrow(
      'authenticated storage route'
    );
  });

  it('does not use a warm cache or environment defaults when the configuration database fails', async () => {
    await fixture();
    await getServerInfra();
    database.failed = true;
    await expect(captureStorageCleanup()).rejects.toThrow('Configuration database unavailable');
  });
});
