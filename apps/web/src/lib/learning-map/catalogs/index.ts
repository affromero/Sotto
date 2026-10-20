import type { LearningCatalog } from '@sotto/shared';
import { germanCatalog } from './europe/de';
import { japaneseCatalog } from './asia/ja';
import { chineseCatalog } from './asia/zh';
import { koreanCatalog } from './asia/ko';
import { englishCatalog } from './europe/en';
import { spanishCatalog } from './europe/es';
import { frenchCatalog } from './europe/fr';
import { portugueseCatalog } from './europe/pt';
import { italianCatalog } from './europe/it';

const catalogs: Readonly<Record<string, LearningCatalog>> = {
  de: germanCatalog,
  ja: japaneseCatalog,
  en: englishCatalog,
  es: spanishCatalog,
  fr: frenchCatalog,
  pt: portugueseCatalog,
  it: italianCatalog,
  zh: chineseCatalog,
  ko: koreanCatalog,
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

export function languageCatalogAvailability(targetLang: string) {
  const catalog = catalogs[targetLang];
  return catalog
    ? { status: 'PUBLISHED' as const, catalog }
    : { status: 'UNAVAILABLE' as const, targetLang };
}

export function publishedLanguageCatalogs(): LearningCatalog[] {
  return Object.values(catalogs);
}
