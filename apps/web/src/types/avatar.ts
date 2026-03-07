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
}

export interface HeyGenAvatarData {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url?: string;
  gender: string;
  premium: boolean;
}
