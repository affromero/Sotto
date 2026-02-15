import { franc } from 'franc-min';

const ISO_639_3_TO_1: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  por: 'pt',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  zho: 'zh',
  ara: 'ar',
  hin: 'hi',
  rus: 'ru',
  nld: 'nl',
  swe: 'sv',
  pol: 'pl',
  tur: 'tr',
  dan: 'da',
  fin: 'fi',
  nor: 'no',
  ces: 'cs',
  ron: 'ro',
  hun: 'hu',
  ell: 'el',
  heb: 'he',
  tha: 'th',
  vie: 'vi',
  ind: 'id',
  msa: 'ms',
  ukr: 'uk',
  cat: 'ca',
};

export function detectLanguage(text: string): string | null {
  if (!text || text.length < 50) return null;
  const code3 = franc(text.slice(0, 1000));
  if (code3 === 'und') return null;
  return ISO_639_3_TO_1[code3] ?? null;
}
