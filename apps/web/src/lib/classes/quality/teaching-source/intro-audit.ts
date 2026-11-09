import {
  ReviewerProtocolError,
  type TeachingReviewPacket as IntroReviewPacket,
} from '../teaching-review-protocol';

export type IntroAuditAddress =
  | { field: 'purpose' | 'about' | 'visuals' }
  | { field: 'focus' | 'tips' | 'examples'; index: number };

export type IntroAuditItem = {
  address: IntroAuditAddress;
  fields: Record<string, unknown>;
};

export type IntroAudit = {
  introContext: Record<string, unknown>;
  items: readonly IntroAuditItem[];
  reviewPackets?: readonly IntroReviewPacket[];
};

export function buildIntroAuditItems(items: readonly unknown[], immersion = false): IntroAudit {
  if (items.length !== 1 || !items[0] || typeof items[0] !== 'object' || Array.isArray(items[0]))
    throw new ReviewerProtocolError();

  const intro = items[0] as Record<string, unknown>;
  const arrays = ['focus', 'tips', 'examples'] as const;
  for (const field of arrays) {
    if (!Array.isArray(intro[field])) throw new ReviewerProtocolError();
  }
  if (
    (intro.focus as unknown[]).length < 1 ||
    (intro.focus as unknown[]).length > 6 ||
    (intro.tips as unknown[]).length < 1 ||
    (intro.tips as unknown[]).length > 5 ||
    (intro.examples as unknown[]).length < 1 ||
    (intro.examples as unknown[]).length > 5
  )
    throw new ReviewerProtocolError();
  const scopes: Array<{ address: IntroAuditAddress; fields: Record<string, unknown> }> = [
    { address: { field: 'purpose' }, fields: { purpose: intro.purpose } },
    { address: { field: 'about' }, fields: { about: intro.about } },
  ];
  for (const [index, focus] of (Array.isArray(intro.focus) ? intro.focus : []).entries())
    scopes.push({ address: { field: 'focus', index }, fields: { focus } });
  for (const [index, tip] of (Array.isArray(intro.tips) ? intro.tips : []).entries())
    scopes.push({ address: { field: 'tips', index }, fields: { tips: tip } });
  for (const [index, example] of (intro.examples as unknown[]).entries()) {
    let reviewedExample: unknown = example;
    if (
      immersion &&
      example &&
      typeof example === 'object' &&
      !Array.isArray(example) &&
      'target' in example &&
      typeof example.target === 'string' &&
      'meaning' in example &&
      example.meaning === example.target
    ) {
      const fields: Record<string, unknown> = { ...example };
      delete fields.meaning;
      reviewedExample = fields;
    }
    scopes.push({ address: { field: 'examples', index }, fields: { example: reviewedExample } });
  }
  if (intro.visuals !== undefined)
    scopes.push({ address: { field: 'visuals' }, fields: { visuals: intro.visuals } });

  return { introContext: intro, items: scopes };
}

export function classIntroAuditAddressCount(intro: unknown): number {
  return buildIntroAuditItems([intro]).items.length;
}

export function introAuditEvidence(audit: IntroAudit) {
  return [
    {
      introContext: audit.introContext,
      addresses: audit.items.map(({ address }) => address),
      reviewPackets: audit.reviewPackets,
    },
  ];
}
