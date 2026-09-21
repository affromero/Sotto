import { expect, it } from 'vitest';
import { resolveCartesiaUsageAllowance } from '@/lib/agent-usage/providers/cartesia';

it('resolves monthly allowance from a provider plan preset', () => {
  expect(resolveCartesiaUsageAllowance({ usagePlan: 'startup' })).toEqual({
    monthlyLimit: 1_250_000,
    planId: 'startup',
    planLabel: 'Startup',
  });
});
