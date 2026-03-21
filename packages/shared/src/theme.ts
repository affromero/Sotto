// Design system tokens — "Warm Intimacy"
// Source of truth shared between web (CSS custom properties) and mobile (StyleSheet)

export const colors = {
  primary: '#D97706',
  primaryHover: '#B45309',
  primaryActive: '#92400E',
  primaryLight: '#FEF3C7',
  primaryLighter: '#FFFBEB',
  primarySubtle: 'rgba(217, 119, 6, 0.08)',

  accent: '#1E3A5F',
  accentHover: '#162D4A',
  accentLight: '#DBEAFE',
  accentLighter: '#EFF6FF',
  accentSubtle: 'rgba(30, 58, 95, 0.08)',

  background: '#FEFCF8',
  surface: '#FFFFFF',
  surfaceHover: '#FFF9F0',
  surfaceElevated: '#FFFFFF',
  border: '#E5E1D8',
  borderHover: '#D1CCC2',

  textPrimary: '#1A1A1A',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  textInverse: '#FFFFFF',

  speakerHost: '#D97706',
  speakerHostBg: '#FEF3C7',
  speakerExpert: '#1E3A5F',
  speakerExpertBg: '#DBEAFE',

  // Indexed speaker palette (up to 4 speakers)
  speakers: [
    { color: '#D97706', bg: '#FEF3C7' },
    { color: '#1E3A5F', bg: '#DBEAFE' },
    { color: '#065F46', bg: '#D1FAE5' },
    { color: '#991B1B', bg: '#FEE2E2' },
  ] as ReadonlyArray<{ color: string; bg: string }>,

  success: '#059669',
  successHover: '#047857',
  successLight: '#D1FAE5',
  successLighter: '#ECFDF5',

  warning: '#F59E0B',
  warningHover: '#D97706',
  warningLight: '#FEF3C7',
  warningLighter: '#FFFBEB',

  error: '#DC2626',
  errorHover: '#B91C1C',
  errorLight: '#FEE2E2',
  errorLighter: '#FEF2F2',

  info: '#2563EB',
  infoHover: '#1D4ED8',
  infoLight: '#DBEAFE',
  infoLighter: '#EFF6FF',
} as const;

export type ColorScheme = { [K in keyof typeof colors]: (typeof colors)[K] extends ReadonlyArray<infer U> ? ReadonlyArray<U> : string };

export const darkColors: ColorScheme = {
  primary: '#E8890F',
  primaryHover: '#D97706',
  primaryActive: '#B45309',
  primaryLight: '#78350F',
  primaryLighter: '#3D2006',
  primarySubtle: 'rgba(232, 137, 15, 0.12)',

  accent: '#5B8ABD',
  accentHover: '#4A7AAD',
  accentLight: '#1E3A5F',
  accentLighter: '#162D4A',
  accentSubtle: 'rgba(91, 138, 189, 0.12)',

  background: '#1A1917',
  surface: '#262420',
  surfaceHover: '#302D28',
  surfaceElevated: '#302D28',
  border: '#3A3733',
  borderHover: '#4A4640',

  textPrimary: '#F0EDE8',
  textSecondary: '#A09B93',
  textTertiary: '#6B665E',
  textInverse: '#1A1917',

  speakerHost: '#E8890F',
  speakerHostBg: '#3D2006',
  speakerExpert: '#5B8ABD',
  speakerExpertBg: '#162D4A',

  speakers: [
    { color: '#E8890F', bg: '#3D2006' },
    { color: '#5B8ABD', bg: '#162D4A' },
    { color: '#34D399', bg: '#064E3B' },
    { color: '#F87171', bg: '#7F1D1D' },
  ] as ReadonlyArray<{ color: string; bg: string }>,

  success: '#34D399',
  successHover: '#10B981',
  successLight: '#064E3B',
  successLighter: '#022C22',

  warning: '#FBBF24',
  warningHover: '#F59E0B',
  warningLight: '#78350F',
  warningLighter: '#3D2006',

  error: '#F87171',
  errorHover: '#EF4444',
  errorLight: '#7F1D1D',
  errorLighter: '#450A0A',

  info: '#60A5FA',
  infoHover: '#3B82F6',
  infoLight: '#1E3A5F',
  infoLighter: '#162D4A',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  xxl: 96,
} as const;

export const typography = {
  fontHeading: 'DM Serif Display',
  fontBody: 'Inter',
  fontMono: 'JetBrains Mono',
} as const;

export const borderRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;
