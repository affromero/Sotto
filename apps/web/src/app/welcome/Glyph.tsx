'use client';

import type { GlyphName } from './data';

interface GlyphProps {
  name: GlyphName;
  size?: number;
  stroke?: number;
}

export function Glyph({ name, size = 20, stroke = 1.6 }: GlyphProps) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <path d="M4 12.5l5 5L20 6" />
        </svg>
      );
    case 'key':
      return (
        <svg {...p}>
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l8 8M16 16l2-2M19 19l1.5-1.5" />
        </svg>
      );
    case 'link':
      return (
        <svg {...p}>
          <path d="M9 15l6-6M10 6l1-1a4 4 0 015.7 5.7l-1 1M14 18l-1 1A4 4 0 017.3 13.3l1-1" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...p}>
          <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0V8zM12 17v4" />
        </svg>
      );
    case 'gate':
      return (
        <svg {...p}>
          <rect x="4" y="10" width="16" height="10" rx="1.5" />
          <path d="M8 10V7a4 4 0 018 0" />
        </svg>
      );
    case 'book':
      return (
        <svg {...p}>
          <path d="M4 5a2 2 0 012-2h6v16H6a2 2 0 00-2 2V5zM20 5a2 2 0 00-2-2h-6v16h6a2 2 0 012 2V5z" />
        </svg>
      );
    case 'wave':
      return (
        <svg {...p}>
          <path d="M3 12h2l2-6 3 14 3-18 3 12 2-2h3" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...p}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0014 0M12 18v3" />
        </svg>
      );
    case 'graph':
      return (
        <svg {...p}>
          <circle cx="6" cy="7" r="2.2" />
          <circle cx="18" cy="6" r="2.2" />
          <circle cx="16" cy="18" r="2.2" />
          <circle cx="7" cy="17" r="2.2" />
          <path d="M8 8.5l8-1.5M8.5 8.5l7 8M9 16l5.5 1M8 9l7.5 7" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...p}>
          <path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...p}>
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
      );
    case 'x':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'repo':
      return (
        <svg {...p}>
          <path d="M6 3h12v18l-6-3-6 3V3z" />
          <path d="M9 7h6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="9" rx="1.5" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...p}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
        </svg>
      );
    case 'dot':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}
