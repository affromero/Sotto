import { describe, expect, it } from 'vitest';
import { prepareStorageBackend, storageBackendBinding } from 'thesidedoor-core/storage';
import { matchesObjectTarget } from '@/lib/sidedoor/storage/migration/relocation/retained-avatar';

describe('historical object references', () => {
  const location = {
    kind: 'object' as const,
    endpoint: 'https://objects.example/base',
    bucket: 'avatars',
  };
  const descriptor = prepareStorageBackend('test', {
    kind: 'object',
    location,
    binding: storageBackendBinding(location),
    publicUrl: 'https://cdn.example/media',
    referenceEncoding: 'percent',
  }).descriptor;
  if (descriptor.kind !== 'object') throw new Error('Expected object backend');
  const keys = new Set(['path/avatar photo.png']);

  it.each([
    'https://cdn.example/media/path/avatar%20photo.png',
    'http://cdn.example./media/path/avatar%20photo.png?download=1',
    'https://objects.example/base/avatars/path/avatar%20photo.png',
    'https://objects.example//base//avatars/path/avatar%20photo.png',
    'https://avatars.objects.example/base/path/avatar%20photo.png',
    'https://objects.example/base%2Favatars%2Fpath%2Favatar%20photo.png',
    'https://cdn.example/media/path%252Favatar%20photo.png',
  ])('recognizes %s', (reference) => {
    expect(matchesObjectTarget(descriptor, reference, keys)).toBe(true);
  });

  it('does not match a different bucket or key', () => {
    expect(
      matchesObjectTarget(
        descriptor,
        'https://objects.example/base/other/path/avatar%20photo.png',
        keys
      )
    ).toBe(false);
    expect(matchesObjectTarget(descriptor, 'https://cdn.example/media/path/other.png', keys)).toBe(
      false
    );
  });

  it('recognizes decoded aliases even when the backend normally stores raw URLs', () => {
    const raw = { ...descriptor, referenceEncoding: 'raw' as const };
    expect(
      matchesObjectTarget(raw, 'https://cdn.example/media/f%69le.png', new Set(['file.png']))
    ).toBe(true);
  });
});
