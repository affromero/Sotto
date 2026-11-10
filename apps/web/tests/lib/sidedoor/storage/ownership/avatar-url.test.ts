import { describe, expect, it } from 'vitest';
import { isManagedAvatarUrl } from '@/lib/sidedoor/access/avatar/url';

describe('avatar URL storage ownership', () => {
  const locations = [
    {
      publicUrl: 'https://old-cdn.example/media',
      endpoint: 'https://objects.example',
      bucket: 'photos',
    },
    {
      publicUrl: 'https://new-cdn.example',
      endpoint: 'https://new-objects.example',
      bucket: 'new',
    },
  ];

  it.each([
    'https://old-cdn.example/media/avatar.png?download=1',
    'http://old-cdn.example:8080/media/avatar.png',
    'https://old-cdn.example./media/avatar.png',
    'https://objects.example/photos/avatar.png',
    'https://photos.objects.example/avatar.png',
    'https://new-cdn.example/avatar.png',
    'https://app.example/api/v1/storage/avatar.png',
    'https://app.example/api//v1/storage/avatar.png',
    'https://objects.example//photos/avatar.png',
    'https://app.example/api%2Fv1%2Fstorage%2Favatar.png',
    'https://app.example/api%252Fv1%252Fstorage%252Favatar.png',
    'https://user:password@external.example/avatar.png',
    'https://external.example/%invalid',
  ])('rejects managed or ambiguous URL %s', (reference) => {
    expect(isManagedAvatarUrl(reference, locations)).toBe(true);
  });

  it('allows unrelated external images', () => {
    expect(isManagedAvatarUrl('https://external.example/avatar.png', locations)).toBe(false);
    expect(isManagedAvatarUrl('https://old-cdn.example/other/avatar.png', locations)).toBe(false);
    expect(isManagedAvatarUrl('https://objects.example/another-bucket/avatar.png', locations)).toBe(
      false
    );
  });
});
