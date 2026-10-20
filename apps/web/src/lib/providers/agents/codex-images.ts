import type { ImageContentPart } from '../ai';

export function decodeCodexImages(images: readonly ImageContentPart[]) {
  const documentPages = images.some((image) => image.documentPage !== undefined);
  const maxImages = documentPages ? 100 : 5;
  const maxBytes = documentPages ? 20 * 1024 * 1024 : 2_000_000;
  if (images.length > maxImages)
    throw new Error(`Codex accepts at most ${maxImages} images per request.`);
  let total = 0;
  return images.map((image, index) => {
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.url);
    if (!match) throw new Error('Codex images must be inline PNG or JPEG data URLs.');
    const bytes = Buffer.from(match[2]!, 'base64');
    total += bytes.length;
    if (!bytes.length || total > maxBytes || bytes.toString('base64') !== match[2])
      throw new Error('Codex image input is malformed or exceeds its byte limit.');
    return { name: `image-${index}.${match[1]}`, bytes };
  });
}
