import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { JsonLd } from '@/components/landing/JsonLd';

describe('landing JsonLd', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://selfhost.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the configured deployment URL for website and organization schema', () => {
    const { container } = render(<JsonLd />);
    const scripts = [...container.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) => JSON.parse(script.textContent ?? '{}')
    );

    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toMatchObject({
      '@type': 'WebSite',
      url: 'https://selfhost.example.com',
    });
    expect(scripts[1]).toMatchObject({
      '@type': 'Organization',
      url: 'https://selfhost.example.com',
      logo: 'https://selfhost.example.com/icon-512.png',
    });
  });
});
