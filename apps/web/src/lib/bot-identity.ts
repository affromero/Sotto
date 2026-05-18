const TWITTER_HANDLE_RE = /@[A-Za-z0-9_]{1,15}/g;

export function normalizeBotHandle(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withoutUrl = trimmed.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '');
  const withoutAt = withoutUrl.replace(/^@/, '').split(/[/?#]/)[0]?.trim();
  if (!withoutAt) return null;
  return `@${withoutAt}`;
}

export function getTwitterBotHandle(): string | null {
  return normalizeBotHandle(process.env.NEXT_PUBLIC_TWITTER_BOT_HANDLE);
}

export function getTelegramBotUsername(): string | null {
  return normalizeBotHandle(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME);
}

export function getTwitterBotLabel(): string {
  return getTwitterBotHandle() ?? 'your configured Twitter bot';
}

export function getTelegramBotLabel(): string {
  return getTelegramBotUsername() ?? 'your Telegram bot';
}

export function getTwitterProfileUrl(handle: string | null | undefined): string | null {
  const normalized = normalizeBotHandle(handle);
  return normalized ? `https://x.com/${normalized.slice(1)}` : null;
}

export function stripTwitterBotMentions(text: string): string {
  const configuredHandle = getTwitterBotHandle();
  if (configuredHandle) {
    const escaped = configuredHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), '').trim();
  }
  return text.replace(TWITTER_HANDLE_RE, '').trim();
}
