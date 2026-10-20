import { describe, expect, it } from 'vitest';
import type { KeyPost } from '@/app/welcome/providerMap';
import { planCredentialWrites } from '@/app/welcome/session/credential-plan';

function local(baseUrl = 'http://127.0.0.1:18200/v1', apiKey = 'endpoint-secret'): KeyPost {
  return { endpoint: 'ai-keys', provider: 'local', baseUrl, apiKey };
}

describe('credential batch planning', () => {
  it('merges matching speech aliases and complementary typed account settings', () => {
    const first: KeyPost = {
      endpoint: 'byok',
      provider: 'cartesia',
      apiKey: 'account-secret',
      extra: { usagePlan: 'custom', monthlyCreditLimit: '72000' },
    };
    const second: KeyPost = {
      ...first,
      extra: { billingResetDay: '9', monthlyCreditLimit: '72000.0' },
    };
    const plan = planCredentialWrites([first, second]);
    expect([...plan.keys()]).toEqual(['byok:cartesia']);
    expect(plan.get('byok:cartesia')?.values).toEqual({
      apiKey: 'account-secret',
      usagePlan: 'custom',
      monthlyCreditLimit: 72000,
      billingResetDay: 9,
    });
  });

  it('rejects competing keys for one physical slot', () => {
    expect(() => planCredentialWrites([local(), local(undefined, 'other-secret')])).toThrow(
      /apiKey/
    );
  });

  it('rejects competing endpoints even when both aliases contain the same key', () => {
    expect(() => planCredentialWrites([local(), local('http://127.0.0.1:18201/v1')])).toThrow(
      /endpoints/i
    );
  });

  it('rejects account settings that conflict after numeric conversion', () => {
    const post: KeyPost = {
      endpoint: 'byok',
      provider: 'cartesia',
      apiKey: 'account-secret',
      extra: { billingResetDay: '9' },
    };
    expect(() =>
      planCredentialWrites([post, { ...post, extra: { billingResetDay: '10' } }])
    ).toThrow(/billingResetDay/);
  });

  it.each(['Infinity', 'NaN', 'not-a-number'])(
    'rejects the invalid numeric account value %s',
    (value) => {
      expect(() =>
        planCredentialWrites([
          {
            endpoint: 'byok',
            provider: 'cartesia',
            apiKey: 'account-secret',
            extra: { monthlyCreditLimit: value },
          },
        ])
      ).toThrow(/Credit Limit/);
    }
  );

  it('rejects fields outside the provider catalogue', () => {
    expect(() =>
      planCredentialWrites([{ ...local(), extra: { unknownSetting: 'unexpected' } }])
    ).toThrow(/Unknown credential field/);
  });

  it('rejects a second secret hidden in the extra field map', () => {
    expect(() => planCredentialWrites([{ ...local(), extra: { apiKey: 'extra-secret' } }])).toThrow(
      /Conflicting API keys/
    );
  });

  it('keeps distinct physical slots separate and leaves the input unchanged', () => {
    const posts: KeyPost[] = [
      local(),
      { endpoint: 'ai-keys', provider: 'openai', apiKey: 'cloud-secret' },
    ];
    const before = structuredClone(posts);
    const plan = planCredentialWrites(posts);
    expect([...plan.keys()]).toEqual(['ai-keys:local', 'ai-keys:openai']);
    expect(plan.get('ai-keys:local')?.baseUrl).toBe('http://127.0.0.1:18200/v1');
    expect(posts).toEqual(before);
  });
});
