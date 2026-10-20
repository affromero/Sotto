import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument } from '../../scripts/generate-openapi';

describe('learning-map client query contracts', () => {
  it('lets generated clients choose lower-band criteria and continue owned history and source pages', () => {
    const document = z
      .object({ paths: z.record(z.string(), z.unknown()) })
      .parse(buildOpenApiDocument());
    const cases = [
      ['/api/v1/courses/{courseId}/learning-map', ['level']],
      ['/api/v1/courses/{courseId}/learning-map/objectives/{objectiveId}', ['level']],
      [
        '/api/v1/courses/{courseId}/learning-map/objectives/{objectiveId}/history',
        ['level', 'after'],
      ],
      ['/api/v1/courses/{courseId}/material-analyses', ['after']],
      ['/api/v1/material-analyses/{analysisId}', ['afterOrder']],
    ] as const;
    for (const [path, names] of cases) {
      const {
        get: { parameters },
      } = z
        .object({ get: z.object({ parameters: z.array(z.unknown()) }) })
        .parse(document.paths[path]);
      for (const name of names)
        expect(parameters).toContainEqual({
          name,
          in: 'query',
          required: false,
          schema: { type: 'string' },
        });
    }
  });
});
