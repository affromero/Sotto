import { describe, expect, it } from 'vitest';
import { learningLevels } from '@sotto/shared';
import { germanCatalog } from '@/lib/learning-map/catalogs/europe/de';
import { japaneseCatalog } from '@/lib/learning-map/catalogs/asia/ja';

describe('language-specific learning catalogs', () => {
  it.each([germanCatalog, japaneseCatalog])(
    '$title offers both branches at every maintained band',
    (catalog) => {
      for (const level of learningLevels)
        for (const branch of ['GRAMMAR', 'SITUATIONS'] as const) {
          const objectives = catalog.nodes.filter(
            (node) => node.kind === 'OBJECTIVE' && node.level === level && node.branch === branch
          );
          expect(objectives.length).toBeGreaterThanOrEqual(4);
          expect(
            objectives.every((node) => node.kind === 'OBJECTIVE' && node.examples.length > 0)
          ).toBe(true);
        }
    }
  );

  it('preserves specific temporal distinctions and distinct passive constructions', () => {
    const titles = germanCatalog.nodes.map((node) => node.title);
    expect(titles).toContain('Choose als or wenn for past events');
    expect(titles).toContain('Sequence past events using nachdem');
    expect(titles).toContain('Form the present passive');
    expect(titles).toContain('Form the past passive');
  });

  it('teaches Japanese structures rather than translating German categories', () => {
    const objectives = japaneseCatalog.nodes.filter(
      (node) => node.kind === 'OBJECTIVE' && node.branch === 'GRAMMAR'
    );
    expect(objectives.some((node) => node.title.includes('は'))).toBe(true);
    expect(objectives.some((node) => node.title.includes('respectful and humble'))).toBe(true);
    expect(objectives.some((node) => node.title.includes('dative'))).toBe(false);
  });
});
