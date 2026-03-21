import { describe, it, expect } from 'vitest';
import { sourceCandidates } from '../src/sourcing.js';

describe('sourceCandidates', () => {
  it('splits by ratio (60/40 default)', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      inNetwork: i < 6,
    }));
    const result = sourceCandidates(
      items,
      (c) => c.inNetwork,
      10
    );
    expect(result.inNetwork.length).toBe(6);
    expect(result.outOfNetwork.length).toBe(4);
  });

  it('fills from other pool when one is exhausted', () => {
    const items = [
      { id: '1', inNetwork: true },
      { id: '2', inNetwork: true },
      // No out-of-network items
    ];
    const result = sourceCandidates(items, (c) => c.inNetwork, 4);
    // inBudget = 2 (60% of 4), outBudget = 2
    // Only 2 in-network items, 0 out-of-network
    // outRemaining = 2, but no more in-network to fill
    expect(result.inNetwork.length).toBe(2);
    expect(result.outOfNetwork.length).toBe(0);
  });

  it('handles empty input', () => {
    const result = sourceCandidates([], () => true, 10);
    expect(result.inNetwork).toEqual([]);
    expect(result.outOfNetwork).toEqual([]);
  });

  it('respects custom ratio', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      inNetwork: i < 10,
    }));
    const result = sourceCandidates(
      items,
      (c) => c.inNetwork,
      10,
      { inNetworkRatio: 0.8 }
    );
    expect(result.inNetwork.length).toBe(8);
    expect(result.outOfNetwork.length).toBe(2);
  });

  it('handles all in-network', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      inNetwork: true,
    }));
    const result = sourceCandidates(items, (c) => c.inNetwork, 5);
    expect(result.inNetwork.length).toBeGreaterThan(0);
  });

  it('handles all out-of-network', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `${i}`,
      inNetwork: false,
    }));
    const result = sourceCandidates(items, (c) => c.inNetwork, 5);
    expect(result.outOfNetwork.length).toBeGreaterThan(0);
  });
});
