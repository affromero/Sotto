import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

function Microchip({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="12" y="12" width="24" height="24" rx="3" stroke="currentColor" strokeWidth="2" />
      <rect x="18" y="18" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
      <line
        x1="18"
        y1="12"
        x2="18"
        y2="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="12"
        x2="24"
        y2="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="30"
        y1="12"
        x2="30"
        y2="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="36"
        x2="18"
        y2="42"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="36"
        x2="24"
        y2="42"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="30"
        y1="36"
        x2="30"
        y2="42"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="18"
        x2="6"
        y2="18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="24"
        x2="6"
        y2="24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="30"
        x2="6"
        y2="30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="18"
        x2="42"
        y2="18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="24"
        x2="42"
        y2="24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="30"
        x2="42"
        y2="30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Flask({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M18 6h12M20 6v14l-10 18a2 2 0 001.74 3h24.52a2 2 0 001.74-3L28 20V6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 34h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BarChart({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="28" width="8" height="14" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="20" y="18" width="8" height="24" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="32" y="8" width="8" height="34" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Hourglass({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M14 6h20M14 42h20M16 6c0 8 8 12 8 18s-8 10-8 18M32 6c0 8-8 12-8 18s8 10 8 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Column({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <line x1="24" y1="10" x2="24" y2="38" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="24" cy="10" rx="8" ry="3" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="24" cy="38" rx="10" ry="3" stroke="currentColor" strokeWidth="2" />
      <line x1="16" y1="10" x2="14" y2="38" stroke="currentColor" strokeWidth="2" />
      <line x1="32" y1="10" x2="34" y2="38" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function HeartPulse({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M24 40s-14-8.35-14-19a8 8 0 0114-5.28A8 8 0 0138 21c0 10.65-14 19-14 19z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="10,24 18,24 21,18 24,30 27,22 30,24 38,24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BrainCircuit({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M24 8a8 8 0 00-8 8c0 2 .7 3.8 1.8 5.2A8 8 0 0012 28a8 8 0 008 8h0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M24 8a8 8 0 018 8c0 2-.7 3.8-1.8 5.2A8 8 0 0136 28a8 8 0 01-8 8h0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="8"
        x2="24"
        y2="42"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="24" cy="18" r="2" fill="currentColor" />
      <circle cx="24" cy="28" r="2" fill="currentColor" />
      <line
        x1="24"
        y1="18"
        x2="30"
        y2="14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="28"
        x2="18"
        y2="32"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CodeBrackets({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <polyline
        points="18,12 8,24 18,36"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="30,12 40,24 30,36"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="26"
        y1="10"
        x2="22"
        y2="38"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Sigma({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M34 10H14l12 14-12 14h20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeadGears({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 38v-4a8 8 0 018-8h0a12 12 0 0012-12v0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="24" cy="14" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="30" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="38" cy="24" r="2" stroke="currentColor" strokeWidth="1.5" />
      <line
        x1="34.5"
        y1="28.5"
        x2="36.5"
        y2="25.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrendLine({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <polyline
        points="6,36 16,26 24,32 42,12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="34,12 42,12 42,20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="6"
        y1="42"
        x2="42"
        y2="42"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Paintbrush({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M34 6L18 22a6 6 0 00-1.5 6L14 30c-2 2-4 4-2 6s4 0 6-2l2-2.5a6 6 0 006-1.5L42 14a4 4 0 000-5.66L37.66 6A4 4 0 0034 6z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MusicNote({ size = 48, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <circle cx="16" cy="36" r="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="36" cy="32" r="5" stroke="currentColor" strokeWidth="2" />
      <line x1="21" y1="36" x2="21" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="41" y1="32" x2="41" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="21" y1="10" x2="41" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function Globe({ size = 48, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="2" />
      <ellipse cx="24" cy="24" rx="8" ry="16" stroke="currentColor" strokeWidth="2" />
      <line x1="8" y1="24" x2="40" y2="24" stroke="currentColor" strokeWidth="2" />
      <path d="M10 16h28M10 32h28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Leaf({ size = 48, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 40C12 40 12 24 24 16c12-8 16-10 16-10s0 16-12 24c-4 2.7-8 4-12 4"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M12 40c4-4 10-10 18-16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function BookOpen({ size = 48, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path
        d="M6 10c4-2 8-2 12-1s8 3 6 5v22c2-2-2-4-6-5s-8-1-12 1V10z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M42 10c-4-2-8-2-12-1s-8 3-6 5v22c-2-2 2-4 6-5s8-1 12 1V10z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function Trophy({ size = 48, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path
        d="M16 8h16v12a8 8 0 01-16 0V8z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M16 12H10a4 4 0 000 8h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 12h6a4 4 0 010 8h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="24" y1="28" x2="24" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 38h16M18 34h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GradCap({ size = 48, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <path d="M24 10L6 20l18 10 18-10L24 10z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M36 26v10c0 2-5.4 4-12 4s-12-2-12-4V26" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="42" y1="20" x2="42" y2="36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const TAG_ICON_MAP: Record<string, React.ComponentType<IconProps>> = {
  technology: Microchip,
  science: Flask,
  business: BarChart,
  history: Hourglass,
  philosophy: Column,
  health: HeartPulse,
  'ai-ml': BrainCircuit,
  programming: CodeBrackets,
  mathematics: Sigma,
  psychology: HeadGears,
  economics: TrendLine,
  'art-design': Paintbrush,
  music: MusicNote,
  'politics-society': Globe,
  environment: Leaf,
  'language-literature': BookOpen,
  'sports-fitness': Trophy,
  education: GradCap,
};

export function getTagIcon(slug: string): React.ComponentType<IconProps> | null {
  return TAG_ICON_MAP[slug] ?? null;
}

export function TagIcon({
  slug,
  size = 48,
  className,
}: {
  slug: string;
  size?: number;
  className?: string;
}) {
  const Icon = TAG_ICON_MAP[slug];
  if (!Icon) return null;
  return <Icon size={size} className={className} />;
}

export const ONBOARDING_TAG_SLUGS = [
  'technology',
  'science',
  'business',
  'history',
  'philosophy',
  'health',
  'ai-ml',
  'programming',
  'mathematics',
  'psychology',
  'economics',
  'art-design',
  'music',
  'politics-society',
  'environment',
  'language-literature',
  'sports-fitness',
  'education',
];
