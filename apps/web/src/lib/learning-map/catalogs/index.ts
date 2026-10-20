import type { LearningCatalog } from '@sotto/shared';
import { germanCatalog } from './europe/de';
import { japaneseCatalog } from './asia/ja';

const catalogs: Readonly<Record<string, LearningCatalog>> = {
  de: germanCatalog,
  ja: japaneseCatalog,
};

export class LearningCatalogUnavailable extends Error {
  constructor(readonly targetLang: string) {
    super(`The ${targetLang} learning catalog has not been published on this server.`);
  }
}

export function getLanguageCatalog(targetLang: string): LearningCatalog {
  const catalog = catalogs[targetLang];
  if (!catalog) throw new LearningCatalogUnavailable(targetLang);
  return catalog;
}

export function publishedLanguageCatalogs(): LearningCatalog[] {
  return Object.values(catalogs);
}
