export interface AvatarOverlayData {
  id: string;
  speaker: string;
  avatarId: string;
  avatarName: string | null;
  previewImageUrl: string | null;
  videoUrl: string | null;
  status: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  durationSeconds: number | null;
  avatarProvider?: string | null;
  avatarImageUrl?: string | null;
  avatarModelId?: string | null;
  maskShape?: string | null;
  chunkVideoUrl?: string | null;
  chunkDurationSeconds?: number | null;
  runwayChunkIndex?: number | null;
  runwayTotalChunks?: number | null;
  falChunkIndex?: number | null;
  falTotalChunks?: number | null;
  enabledSegmentIds?: string[];
  voiceTrackId?: string | null;
}

export interface HeyGenAvatarData {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url?: string;
  gender: string;
  premium: boolean;
}

export interface UnifiedAvatarData {
  id: string;
  name: string;
  previewImageUrl: string;
  imageUrl?: string;
  provider: 'heygen' | 'runway' | 'fal' | 'replicate';
  isPreset: boolean;
  premium: boolean;
}
