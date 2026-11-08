import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';

/** Canonical private projection used to bind a writing task to its grade. */
export function assessmentWritingTask(prompt: Prisma.WritingPromptGetPayload<object>) {
  if (!prompt.assessmentRubric) throw new Error('Assessment writing rubric is missing.');
  return {
    id: prompt.id,
    task: prompt.task,
    privateRubric: prompt.assessmentRubric,
    privateGuidance: prompt.guidance,
    privateIdeas: prompt.ideas,
    privateLearningObjectives: z.json().nullable().parse(prompt.learningObjectives),
  };
}
