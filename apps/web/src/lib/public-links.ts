function readPublicUrl(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getPublicGithubUrl(): string | null {
  return readPublicUrl('NEXT_PUBLIC_GITHUB_URL');
}

export function getPublicDiscordUrl(): string | null {
  return readPublicUrl('NEXT_PUBLIC_DISCORD_URL');
}

export function getVerificationStandardUrl(): string | null {
  return readPublicUrl('NEXT_PUBLIC_VERIFICATION_STANDARD_URL');
}
