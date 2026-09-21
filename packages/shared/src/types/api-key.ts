export interface ApiKeyData {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
  status: 'active' | 'revoked' | 'expired' | 'unavailable';
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  key: string; // Full key, shown only once
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
}
