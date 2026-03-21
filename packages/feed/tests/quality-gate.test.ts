import { describe, it, expect } from 'vitest';
import { applyQualityGate } from '../src/quality-gate.js';

describe('applyQualityGate', () => {
  it('fails below threshold', () => {
    expect(applyQualityGate(5, { enabled: true, minReputation: 10 })).toBe(false);
  });

  it('passes at threshold', () => {
    expect(applyQualityGate(10, { enabled: true, minReputation: 10 })).toBe(true);
  });

  it('passes above threshold', () => {
    expect(applyQualityGate(50, { enabled: true, minReputation: 10 })).toBe(true);
  });

  it('passes undefined reputation (new creator)', () => {
    expect(applyQualityGate(undefined, { enabled: true, minReputation: 10 })).toBe(true);
  });

  it('passes everything when disabled', () => {
    expect(applyQualityGate(0, { enabled: false, minReputation: 10 })).toBe(true);
  });

  it('uses default config when none provided', () => {
    expect(applyQualityGate(10)).toBe(true);
    expect(applyQualityGate(5)).toBe(false);
  });
});
