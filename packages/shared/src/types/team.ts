export interface TeamSummary {
  id: string;
  name: string;
  ownerId: string;
  seats: number;
  memberCount: number;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  joinedAt: string;
}

export interface TeamInviteData {
  id: string;
  email: string;
  status: string;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}
