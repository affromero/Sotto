import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ApiKeyData } from '@/types/api-key';
import { ApiKeyManager } from '@/app/(dashboard)/settings/devices/ApiKeyManager';

describe('device key history', () => {
  it('counts only canonical active credentials and labels inactive history accurately', () => {
    const keys: ApiKeyData[] = ['active', 'expired', 'revoked', 'unavailable'].map(
      (status, index) => ({
        id: String(index),
        name: `Device ${index}`,
        keyPrefix: 'sk_sotto_prefix...',
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        revokedAt: status === 'revoked' ? '2026-02-01T00:00:00.000Z' : null,
        expiresAt: status === 'expired' ? '2026-03-01T00:00:00.000Z' : null,
        status: status as ApiKeyData['status'],
      })
    );
    render(<ApiKeyManager initialKeys={keys} />);
    expect(screen.getByRole('heading', { name: 'Active Keys (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inactive Keys (3)' })).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('No expiry')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
  });
});
