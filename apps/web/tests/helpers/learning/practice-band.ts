import { createSkillRequirements } from '@sotto/shared';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { learningCatalogHash } from '@/lib/learning-map/catalog';

export function practiceBandFixture() {
  const catalog = getLanguageCatalog('es');
  return {
    id: 'pinned-unit-band',
    level: 'A1',
    policyVersion: 1,
    coverage: createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'es',
      level: 'A1',
      ttsProvider: 'cartesia',
      sttProvider: 'openai',
    }),
    revision: {
      id: 'unit-revision',
      targetLang: 'es',
      version: catalog.version,
      catalogHash: learningCatalogHash(catalog),
      definition: catalog,
    },
  };
}
