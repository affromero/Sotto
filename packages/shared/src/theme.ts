// Design system tokens — "SottoDesign aula"
// Source of truth shared between web (CSS custom properties) and mobile (StyleSheet)

export const colors = {
  primary: '#3F4FB0',
  primaryHover: '#34419A',
  primaryActive: '#2A3580',
  primaryLight: '#E3E6F6',
  primaryLighter: '#F0F2FF',
  primarySubtle: 'rgba(63, 79, 176, 0.08)',

  accent: '#2A3550',
  accentHover: '#1E2128',
  accentLight: '#E2E4EC',
  accentLighter: '#F0F1F6',
  accentSubtle: 'rgba(42, 53, 80, 0.08)',

  background: '#F5F4F0',
  surface: '#FFFFFF',
  surfaceHover: '#FBFAF7',
  surfaceElevated: '#FFFFFF',
  border: '#DEDDD6',
  borderHover: '#CCCBC3',

  textPrimary: '#1E2128',
  textSecondary: '#565B68',
  textTertiary: '#8A8F9C',
  textInverse: '#FFFFFF',

  speakerHost: '#3F4FB0',
  speakerHostBg: '#E3E6F6',
  speakerExpert: '#2A3550',
  speakerExpertBg: '#E2E4EC',

  // Indexed speaker palette (up to 4 voices)
  speakers: [
    { color: '#3F4FB0', bg: '#E3E6F6' },
    { color: '#2A3550', bg: '#E2E4EC' },
    { color: '#0D9488', bg: '#D1FAE5' },
    { color: '#B83280', bg: '#FBE3F0' },
  ] as ReadonlyArray<{ color: string; bg: string }>,

  success: '#059669',
  successHover: '#047857',
  successLight: '#D1FAE5',
  successLighter: '#ECFDF5',

  warning: '#F59E0B',
  warningHover: '#C2730A',
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
  primary: '#6A9BFF',
  primaryHover: '#88B0FF',
  primaryActive: '#3F4FB0',
  primaryLight: '#1E2540',
  primaryLighter: '#1A1F33',
  primarySubtle: 'rgba(106, 155, 255, 0.14)',

  accent: '#8A93B5',
  accentHover: '#A2ABC9',
  accentLight: '#20242F',
  accentLighter: '#1A1E29',
  accentSubtle: 'rgba(138, 147, 181, 0.12)',

  background: '#121310',
  surface: '#1B1D17',
  surfaceHover: '#23251D',
  surfaceElevated: '#1F2118',
  border: '#33352C',
  borderHover: '#44473B',

  textPrimary: '#E9E3D3',
  textSecondary: '#9D9684',
  textTertiary: '#6E6857',
  textInverse: '#121310',

  speakerHost: '#6A9BFF',
  speakerHostBg: '#1E2540',
  speakerExpert: '#8A93B5',
  speakerExpertBg: '#20242F',

  speakers: [
    { color: '#6A9BFF', bg: '#1E2540' },
    { color: '#8A93B5', bg: '#20242F' },
    { color: '#34D399', bg: '#1A2E25' },
    { color: '#F472B6', bg: '#341A2A' },
  ] as ReadonlyArray<{ color: string; bg: string }>,

  success: '#34D399',
  successHover: '#10B981',
  successLight: '#1A2E25',
  successLighter: '#162822',

  warning: '#FBBF24',
  warningHover: '#F59E0B',
  warningLight: '#3D3014',
  warningLighter: '#2D2518',

  error: '#F87171',
  errorHover: '#EF4444',
  errorLight: '#3D1A1A',
  errorLighter: '#2D1818',

  info: '#60A5FA',
  infoHover: '#3B82F6',
  infoLight: '#1A2540',
  infoLighter: '#182035',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  ms: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  xxl: 96,
} as const;

export const typography = {
  fontHeading: 'Newsreader',
  fontBody: 'IBM Plex Sans',
  fontMono: 'IBM Plex Mono',
} as const;

export const borderRadius = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  full: 9999,
} as const;
