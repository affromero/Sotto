const BLOCKED_COMPACT_FRAGMENTS = [
  'fuck',
  'shit',
  'cunt',
  'pussy',
  'porn',
  'xxx',
  'nazi',
  'kkk',
];

const BLOCKED_TOKEN_TERMS = new Set(['bitch', 'dick']);

const SOTTO_IMPERSONATION_TERMS = new Set([
  'admin',
  'administrator',
  'moderator',
  'official',
  'staff',
  'support',
  'system',
]);

function normalizeModerationText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeLeetspeak(value: string): string {
  return value
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't');
}

export function containsBlockedModerationTerm(value: string): boolean {
  const normalized = normalizeModerationText(value);
  const compact = normalizeLeetspeak(normalized.replace(/[^a-z0-9]/g, ''));

  if (BLOCKED_COMPACT_FRAGMENTS.some((term) => compact.includes(term))) {
    return true;
  }

  const tokens = normalizeLeetspeak(normalized)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  return tokens.some((token) => BLOCKED_TOKEN_TERMS.has(token));
}

export function looksLikeSottoImpersonation(value: string): boolean {
  const tokens = normalizeModerationText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const tokenSet = new Set(tokens);

  return tokenSet.has('sotto') && tokens.some((token) => SOTTO_IMPERSONATION_TERMS.has(token));
}
