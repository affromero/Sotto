import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { resolveImageProvider } from '@/lib/providers/image';
import { logger } from '@/lib/logger';
import type { AvatarImage } from '@prisma/client';
import type { VoicePoolEntry } from '@/lib/voice-pool';

export async function getOrCreateDefaultAvatarImage(
  userId: string,
  voiceEntry: VoicePoolEntry,
): Promise<AvatarImage> {
  const name = `default-${voiceEntry.name}`;

  const existing = await prisma.avatarImage.findFirst({
    where: { userId, name, sourceType: 'DEFAULT' },
  });
  if (existing) return existing;

  const prompt = [
    'Professional portrait photograph',
    voiceEntry.gender,
    voiceEntry.ageRange === 'young' ? 'young adult' : voiceEntry.ageRange === 'mature' ? 'older adult' : 'middle-aged',
    `${voiceEntry.accent} accent`,
    voiceEntry.character,
    'narrator avatar',
    'simple neutral background',
    'head and shoulders',
  ].join(', ');

  const { provider } = await resolveImageProvider({ userId });
  const buffer = await provider.generateImage({ prompt, width: 512, height: 512 });

  const timestamp = Date.now();
  const key = `avatar-images/${userId}/default-${timestamp}.png`;
  const imageUrl = await uploadFile(key, buffer, 'image/png');

  const image = await prisma.avatarImage.create({
    data: {
      userId,
      name,
      imageUrl,
      sourceType: 'DEFAULT',
      prompt,
    },
  });

  logger.info('Created default avatar image from voice metadata', {
    userId,
    voiceName: voiceEntry.name,
    imageId: image.id,
  });

  return image;
}
