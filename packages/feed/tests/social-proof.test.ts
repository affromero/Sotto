import { describe, it, expect } from 'vitest';
import { applySocialProofGate } from '../src/social-proof.js';

describe('applySocialProofGate', () => {
  it('always passes in-network candidates', () => {
    expect(
      applySocialProofGate({
        isInNetwork: true,
        engagerIds: new Set(),
        userFollowingIds: new Set(),
      })
    ).toBe(true);
  });

  it('passes out-of-network with mutual engagers', () => {
    expect(
      applySocialProofGate({
        isInNetwork: false,
        engagerIds: new Set(['user-a', 'user-b']),
        userFollowingIds: new Set(['user-a', 'user-c']),
      })
    ).toBe(true);
  });

  it('fails out-of-network without mutual engagers', () => {
    expect(
      applySocialProofGate({
        isInNetwork: false,
        engagerIds: new Set(['user-x', 'user-y']),
        userFollowingIds: new Set(['user-a', 'user-b']),
      })
    ).toBe(false);
  });

  it('fails out-of-network with empty engagers', () => {
    expect(
      applySocialProofGate({
        isInNetwork: false,
        engagerIds: new Set(),
        userFollowingIds: new Set(['user-a']),
      })
    ).toBe(false);
  });

  it('passes everything when disabled', () => {
    expect(
      applySocialProofGate(
        {
          isInNetwork: false,
          engagerIds: new Set(),
          userFollowingIds: new Set(),
        },
        { enabled: false, minMutualEngagers: 1 }
      )
    ).toBe(true);
  });

  it('respects custom minMutualEngagers', () => {
    expect(
      applySocialProofGate(
        {
          isInNetwork: false,
          engagerIds: new Set(['user-a']),
          userFollowingIds: new Set(['user-a']),
        },
        { enabled: true, minMutualEngagers: 2 }
      )
    ).toBe(false);

    expect(
      applySocialProofGate(
        {
          isInNetwork: false,
          engagerIds: new Set(['user-a', 'user-b']),
          userFollowingIds: new Set(['user-a', 'user-b']),
        },
        { enabled: true, minMutualEngagers: 2 }
      )
    ).toBe(true);
  });
});
