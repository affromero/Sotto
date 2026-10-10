import { z } from 'zod';

export const introVisualsSchema = z.object({
  timeline: z
    .object({
      title: z.string().min(1),
      steps: z.array(z.string().min(1)).min(2).max(6),
    })
    .nullable()
    .optional(),
  contrast: z
    .object({
      title: z.string().min(1),
      leftLabel: z.string().min(1),
      leftItems: z.array(z.string().min(1)).min(1).max(5),
      rightLabel: z.string().min(1),
      rightItems: z.array(z.string().min(1)).min(1).max(5),
    })
    .nullable()
    .optional(),
  callouts: z
    .array(
      z.object({
        label: z.string().min(1),
        text: z.string().min(1),
        tone: z.enum(['blue', 'teal', 'rose', 'amber']).optional(),
      })
    )
    .max(4)
    .optional(),
  links: z
    .array(
      z.object({
        label: z.string().min(1),
        url: z.string().url(),
      })
    )
    .max(3)
    .optional(),
});

export const introSchema = z.object({
  purpose: z.string().min(1),
  about: z.string().min(1),
  focus: z.array(z.string().min(1)).min(1).max(6),
  examples: z
    .array(
      z.object({
        target: z.string().min(1),
        meaning: z.string().min(1),
        note: z.string().min(1),
      })
    )
    .min(1)
    .max(5),
  tips: z.array(z.string().min(1)).min(1).max(5),
  visuals: z.unknown().optional(),
});

export const scopedIntroAtomSchema = z
  .object({ text: z.string().min(1), exampleIndex: z.number().int().min(0) })
  .strict();
export const introExampleReferenceSchema = scopedIntroAtomSchema
  .pick({ exampleIndex: true })
  .strict();
const freshVisualsSchema = z
  .object({
    timeline: introVisualsSchema.shape.timeline.unwrap().unwrap().strict().nullable(),
    contrast: introVisualsSchema.shape.contrast.unwrap().unwrap().strict().nullable(),
    callouts: z
      .array(
        introVisualsSchema.shape.callouts
          .unwrap()
          .element.extend({
            tone: introVisualsSchema.shape.callouts.unwrap().element.shape.tone.unwrap(),
          })
          .strict()
      )
      .max(4),
    links: z.array(introVisualsSchema.shape.links.unwrap().element.strict()).max(3),
  })
  .strict();
export function freshIntroProtocol(immersion: boolean) {
  const exampleSchema = immersion
    ? introSchema.shape.examples.element.omit({ meaning: true }).strict()
    : introSchema.shape.examples.element.strict();
  const schema = introSchema
    .extend({
      about: introExampleReferenceSchema,
      focus: z.array(scopedIntroAtomSchema).min(1).max(6),
      tips: z.array(scopedIntroAtomSchema).min(1).max(5),
      examples: z.array(exampleSchema).min(1).max(5),
      visuals: freshVisualsSchema.nullable(),
    })
    .strict();
  const repairSchema = schema.omit({ visuals: true }).strict();
  return {
    schema,
    repairSchema,
    exampleSchema,
    generationResponseFormat: {
      name: 'class_intro_generation',
      schema: z.toJSONSchema(schema, {
        target: 'draft-7',
        override: ({ jsonSchema }) => {
          if (jsonSchema.format === 'uri') delete jsonSchema.format;
        },
      }),
    },
    repairResponseFormat: {
      name: 'class_intro_repair',
      schema: z.toJSONSchema(repairSchema, { target: 'draft-7' }),
    },
  };
}
