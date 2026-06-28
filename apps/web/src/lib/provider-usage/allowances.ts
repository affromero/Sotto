export interface ProviderUsageAllowancePreset {
  id: string;
  label: string;
  monthlyLimit: number;
}

export interface ProviderUsageAllowance {
  kind: 'monthly_limit';
  unitLabel: string;
  planField: string;
  allowanceField: string;
  resetDayField: string;
  presets: ProviderUsageAllowancePreset[];
}

export const CARTESIA_USAGE_ALLOWANCE: ProviderUsageAllowance = {
  kind: 'monthly_limit',
  unitLabel: 'credits',
  planField: 'usagePlan',
  allowanceField: 'monthlyCreditLimit',
  resetDayField: 'billingResetDay',
  presets: [
    { id: 'free', label: 'Free', monthlyLimit: 20_000 },
    { id: 'pro', label: 'Pro', monthlyLimit: 100_000 },
    { id: 'startup', label: 'Startup', monthlyLimit: 1_250_000 },
    { id: 'scale', label: 'Scale', monthlyLimit: 8_000_000 },
  ],
};
