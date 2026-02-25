import type { ContentDomain } from './types';
import { DOMAIN_CONFIGS } from './domains';

interface ClassifyInput {
  doi?: string | null;
  url?: string | null;
  type?: string | null;
}

export function classifyReference(ref: ClassifyInput): ContentDomain {
  // 1. DOI present → always ACADEMIC
  if (ref.doi) return 'ACADEMIC';

  const url = ref.url ?? '';
  const type = ref.type ?? '';

  // 2. URL pattern matching (priority: ACADEMIC > NEWS > GOVERNMENT)
  const urlCheckOrder: ContentDomain[] = ['ACADEMIC', 'NEWS', 'GOVERNMENT'];
  for (const domain of urlCheckOrder) {
    if (DOMAIN_CONFIGS[domain].urlPatterns?.some((p) => p.test(url))) return domain;
  }

  // 3. ReferenceType fallback (PAPER/BOOK/REPORT → ACADEMIC first)
  const typeCheckOrder: ContentDomain[] = ['ACADEMIC', 'NEWS', 'GOVERNMENT', 'GENERAL'];
  for (const domain of typeCheckOrder) {
    if (DOMAIN_CONFIGS[domain].typePatterns?.includes(type)) return domain;
  }

  return 'GENERAL';
}
