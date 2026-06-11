/**
 * Mock-exam blueprint catalog: full coverage (every institution x every CEFR
 * level), valid shapes, and weights that sum to ~1 per exam. These format specs
 * are the contract the exam generator builds against.
 */
import { describe, it, expect } from 'vitest';
import {
  getBlueprint,
  listBlueprints,
  resolveExamInstitution,
  examBlueprintSchema,
} from '@/lib/exam-blueprint';
import type { CefrLevel, ExamInstitution } from '@sotto/shared';

const INSTITUTIONS: ExamInstitution[] = ['GOETHE', 'DELE', 'CAMBRIDGE', 'CEFR_GENERIC'];
const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

describe('exam blueprint catalog', () => {
  it('covers every institution at every level', () => {
    const all = listBlueprints();
    expect(all).toHaveLength(INSTITUTIONS.length * LEVELS.length);
  });

  it('every blueprint passes its own schema and has a unique id', () => {
    const all = listBlueprints();
    const ids = new Set<string>();
    for (const bp of all) {
      expect(() => examBlueprintSchema.parse(bp)).not.toThrow();
      expect(ids.has(bp.id)).toBe(false);
      ids.add(bp.id);
    }
  });

  it('section weights sum to ~1 in every blueprint', () => {
    for (const bp of listBlueprints()) {
      const sum = bp.sections.reduce((acc, s) => acc + s.weight, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('every section has a non-empty part name and a positive item count', () => {
    for (const bp of listBlueprints()) {
      for (const s of bp.sections) {
        expect(s.part.trim().length).toBeGreaterThan(0);
        expect(s.itemCount).toBeGreaterThan(0);
      }
    }
  });

  it('maps target languages to their flagship exam, falling back to CEFR', () => {
    expect(resolveExamInstitution('de')).toBe('GOETHE');
    expect(resolveExamInstitution('es')).toBe('DELE');
    expect(resolveExamInstitution('en')).toBe('CAMBRIDGE');
    expect(resolveExamInstitution('ja')).toBe('CEFR_GENERIC');
  });

  it('Cambridge uses per-level qualification names; Goethe and DELE include the level', () => {
    expect(getBlueprint('CAMBRIDGE', 'B2').examName).toContain('B2 First');
    expect(getBlueprint('GOETHE', 'B1').examName).toBe('Goethe-Zertifikat B1');
    expect(getBlueprint('DELE', 'A2').examName).toBe('DELE A2');
  });

  it('Cambridge includes a Use of English (grammar) section', () => {
    const skills = getBlueprint('CAMBRIDGE', 'C1').sections.map((s) => s.skill);
    expect(skills).toContain('GRAMMAR');
  });
});
