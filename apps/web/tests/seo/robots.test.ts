import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import robots from '@/app/robots';

interface Rule {
  userAgent: string;
  disallow: string[];
}

describe('robots.ts', () => {
  let result: ReturnType<typeof robots>;
  let rules: Rule[];

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
    result = robots();
    rules = result.rules as Rule[];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a default rule for all user agents', () => {
    const defaultRule = rules.find((r) => r.userAgent === '*');
    expect(defaultRule).toBeDefined();
  });

  it('disallows private paths for all user agents', () => {
    const defaultRule = rules.find((r) => r.userAgent === '*')!;
    const disallowed = defaultRule.disallow;
    expect(disallowed).toContain('/api/');
    expect(disallowed).toContain('/admin');
    expect(disallowed).toContain('/auth/');
    expect(disallowed).toContain('/dashboard');
    expect(disallowed).toContain('/create');
    expect(disallowed).toContain('/settings');
    expect(disallowed).toContain('/billing');
    expect(disallowed).toContain('/analytics');
    expect(disallowed).toContain('/welcome');
    expect(disallowed).toContain('/team');
    expect(disallowed).toContain('/pitch');
    expect(disallowed).toContain('/_next/');
    expect(disallowed).not.toContain('/profile/');
  });

  it('blocks GPTBot from all paths', () => {
    const gptBot = rules.find((r) => r.userAgent === 'GPTBot');
    expect(gptBot).toBeDefined();
    expect(gptBot!.disallow).toEqual(['/']);
  });

  it('blocks ClaudeBot from all paths', () => {
    const claudeBot = rules.find((r) => r.userAgent === 'ClaudeBot');
    expect(claudeBot).toBeDefined();
    expect(claudeBot!.disallow).toEqual(['/']);
  });

  it('blocks at least 35 AI crawlers', () => {
    const aiRules = rules.filter((r) => r.userAgent !== '*');
    expect(aiRules.length).toBeGreaterThanOrEqual(35);
  });

  it('every AI crawler rule blocks root path', () => {
    const aiRules = rules.filter((r) => r.userAgent !== '*');
    for (const rule of aiRules) {
      expect(rule.disallow).toEqual(['/']);
    }
  });

  it('references the sitemap', () => {
    expect(result.sitemap).toBe('https://selfhost.example.com/sitemap.xml');
  });
});
