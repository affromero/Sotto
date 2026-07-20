// Mock-exam blueprints: the FORMAT spec for each flagship CEFR exam, at every
// level. We replicate STRUCTURE only (section names, skills, item counts, time,
// weights) and never reproduce copyrighted exam content. The generator fills each
// section with AI-composed content via the existing class generator cores.
//
// Full coverage on purpose: every institution x every CEFR level resolves to a
// complete, multi-section blueprint. A single typed module (vs many JSON files)
// keeps the catalog the single source of truth and Zod-validated at the boundary.
import { z } from 'zod';
import type { CefrLevel, ExamInstitution, SkillType } from '@sotto/shared';

export type ExamSectionFormat = 'mc' | 'listening' | 'speaking' | 'writing';

export const blueprintSectionSchema = z.object({
  skill: z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']),
  part: z.string().min(1),
  format: z.enum(['mc', 'listening', 'speaking', 'writing']),
  itemCount: z.number().int().positive().max(20),
  minutes: z.number().int().positive().max(180),
  weight: z.number().gt(0).max(1),
});

export const examBlueprintSchema = z.object({
  id: z.string().min(1),
  institution: z.enum(['GOETHE', 'DELE', 'CAMBRIDGE', 'CEFR_GENERIC']),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  examName: z.string().min(1),
  sections: z.array(blueprintSectionSchema).min(3),
});

export type BlueprintSection = z.infer<typeof blueprintSectionSchema> & { skill: SkillType };
export type ExamBlueprint = z.infer<typeof examBlueprintSchema> & {
  institution: ExamInstitution;
  level: CefrLevel;
  sections: BlueprintSection[];
};

const LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// A reusable section template; minutes scale slightly with level at build time.
interface SectionTemplate {
  skill: SkillType;
  part: string;
  format: ExamSectionFormat;
  itemCount: number;
  baseMinutes: number;
  weight: number;
}

interface InstitutionFormat {
  slug: string;
  examName: (level: CefrLevel) => string;
  sections: SectionTemplate[];
}

// Higher levels get a little more time per section (a soft timer in the UI).
function levelMinutes(base: number, level: CefrLevel): number {
  const bump = LEVELS.indexOf(level) * 4;
  return base + bump;
}

const FORMATS: Record<ExamInstitution, InstitutionFormat> = {
  // Goethe-Zertifikat: four modules, consistent across A1..C2.
  GOETHE: {
    slug: 'goethe',
    examName: (level) => `Goethe-Zertifikat ${level}`,
    sections: [
      {
        skill: 'READING',
        part: 'Lesen',
        format: 'mc',
        itemCount: 6,
        baseMinutes: 45,
        weight: 0.25,
      },
      {
        skill: 'LISTENING',
        part: 'Hören',
        format: 'listening',
        itemCount: 5,
        baseMinutes: 30,
        weight: 0.25,
      },
      {
        skill: 'WRITING',
        part: 'Schreiben',
        format: 'writing',
        itemCount: 2,
        baseMinutes: 45,
        weight: 0.25,
      },
      {
        skill: 'SPEAKING',
        part: 'Sprechen',
        format: 'speaking',
        itemCount: 3,
        baseMinutes: 15,
        weight: 0.25,
      },
    ],
  },
  // DELE (Instituto Cervantes): four pruebas, consistent across A1..C2.
  DELE: {
    slug: 'dele',
    examName: (level) => `DELE ${level}`,
    sections: [
      {
        skill: 'READING',
        part: 'Comprensión de lectura',
        format: 'mc',
        itemCount: 6,
        baseMinutes: 45,
        weight: 0.25,
      },
      {
        skill: 'LISTENING',
        part: 'Comprensión auditiva',
        format: 'listening',
        itemCount: 5,
        baseMinutes: 30,
        weight: 0.25,
      },
      {
        skill: 'WRITING',
        part: 'Expresión e interacción escritas',
        format: 'writing',
        itemCount: 2,
        baseMinutes: 50,
        weight: 0.25,
      },
      {
        skill: 'SPEAKING',
        part: 'Expresión e interacción orales',
        format: 'speaking',
        itemCount: 3,
        baseMinutes: 15,
        weight: 0.25,
      },
    ],
  },
  // Cambridge English Qualifications: papers including Use of English (grammar).
  CAMBRIDGE: {
    slug: 'cambridge',
    examName: (level) => `Cambridge English ${cambridgeName(level)}`,
    sections: [
      {
        skill: 'READING',
        part: 'Reading',
        format: 'mc',
        itemCount: 6,
        baseMinutes: 40,
        weight: 0.2,
      },
      {
        skill: 'GRAMMAR',
        part: 'Use of English',
        format: 'mc',
        itemCount: 6,
        baseMinutes: 30,
        weight: 0.2,
      },
      {
        skill: 'LISTENING',
        part: 'Listening',
        format: 'listening',
        itemCount: 5,
        baseMinutes: 30,
        weight: 0.2,
      },
      {
        skill: 'WRITING',
        part: 'Writing',
        format: 'writing',
        itemCount: 2,
        baseMinutes: 45,
        weight: 0.2,
      },
      {
        skill: 'SPEAKING',
        part: 'Speaking',
        format: 'speaking',
        itemCount: 3,
        baseMinutes: 15,
        weight: 0.2,
      },
    ],
  },
  // Institution-agnostic CEFR mock (the fallback when no flagship is mapped).
  CEFR_GENERIC: {
    slug: 'cefr',
    examName: (level) => `CEFR ${level} Practice Exam`,
    sections: [
      {
        skill: 'READING',
        part: 'Reading',
        format: 'mc',
        itemCount: 6,
        baseMinutes: 40,
        weight: 0.25,
      },
      {
        skill: 'LISTENING',
        part: 'Listening',
        format: 'listening',
        itemCount: 5,
        baseMinutes: 30,
        weight: 0.25,
      },
      {
        skill: 'WRITING',
        part: 'Writing',
        format: 'writing',
        itemCount: 2,
        baseMinutes: 45,
        weight: 0.25,
      },
      {
        skill: 'SPEAKING',
        part: 'Speaking',
        format: 'speaking',
        itemCount: 3,
        baseMinutes: 15,
        weight: 0.25,
      },
    ],
  },
};

// Cambridge's per-level qualification names.
function cambridgeName(level: CefrLevel): string {
  const map: Record<CefrLevel, string> = {
    A1: 'A1',
    A2: 'A2 Key',
    B1: 'B1 Preliminary',
    B2: 'B2 First',
    C1: 'C1 Advanced',
    C2: 'C2 Proficiency',
  };
  return map[level];
}

/** Which flagship exam a target language maps to (ISO 639-1). */
export function resolveExamInstitution(targetLang: string): ExamInstitution {
  switch (targetLang.toLowerCase()) {
    case 'de':
      return 'GOETHE';
    case 'es':
      return 'DELE';
    case 'en':
      return 'CAMBRIDGE';
    default:
      return 'CEFR_GENERIC';
  }
}

/** Build the blueprint for an institution at a level. Validated before return. */
export function getBlueprint(institution: ExamInstitution, level: CefrLevel): ExamBlueprint {
  const fmt = FORMATS[institution];
  const blueprint = {
    id: `${fmt.slug}/${level.toLowerCase()}`,
    institution,
    level,
    examName: fmt.examName(level),
    sections: fmt.sections.map((s) => ({
      skill: s.skill,
      part: s.part,
      format: s.format,
      itemCount: s.itemCount,
      minutes: levelMinutes(s.baseMinutes, level),
      weight: s.weight,
    })),
  };
  return examBlueprintSchema.parse(blueprint) as ExamBlueprint;
}

/** Every blueprint (all institutions x all levels) — used by the catalog test. */
export function listBlueprints(): ExamBlueprint[] {
  const institutions = Object.keys(FORMATS) as ExamInstitution[];
  return institutions.flatMap((inst) => LEVELS.map((level) => getBlueprint(inst, level)));
}

export const EXAM_INSTITUTION_LABELS: Record<ExamInstitution, string> = {
  GOETHE: 'Goethe-Institut',
  DELE: 'Instituto Cervantes (DELE)',
  CAMBRIDGE: 'Cambridge Assessment English',
  CEFR_GENERIC: 'CEFR',
};
