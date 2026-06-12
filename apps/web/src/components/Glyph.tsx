/**
 * Glyph — the shared aula line-icon set, ported faithfully from the SottoDesign
 * prototype (24x24 viewBox, currentColor stroke, round caps). Pure SVG, no hooks,
 * so it works in both Server and Client Components. The welcome flow re-exports
 * this; the admin console and learn surfaces consume it directly.
 */

export type GlyphName =
  | 'arrow'
  | 'back'
  | 'check'
  | 'x'
  | 'key'
  | 'link'
  | 'plug'
  | 'gate'
  | 'book'
  | 'wave'
  | 'mic'
  | 'pen'
  | 'graph'
  | 'spark'
  | 'upload'
  | 'repo'
  | 'lock'
  | 'shield'
  | 'dot'
  | 'clock'
  | 'play'
  | 'pause'
  | 'retry'
  | 'today'
  | 'map'
  | 'gear'
  | 'flame'
  | 'volume'
  | 'plus'
  | 'headset'
  | 'sun'
  | 'moon'
  | 'globe';

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
    case 'back':
      return (
        <svg {...p}>
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <path d="M4 12.5l5 5L20 6" />
        </svg>
      );
    case 'x':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
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
          <path d="M9 12h6M10 8H8a4 4 0 000 8h2M14 8h2a4 4 0 010 8h-2" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...p}>
          <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 01-10 0V8zM12 16v5" />
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
    case 'pen':
      return (
        <svg {...p}>
          <path d="M4 20l4-1L20 7a2 2 0 00-3-3L5 16l-1 4z" />
          <path d="M14 6l3 3" />
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
    case 'clock':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'play':
      return (
        <svg {...p}>
          <path d="M7 5l12 7-12 7V5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...p}>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'retry':
      return (
        <svg {...p}>
          <path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7M4 4v4h4" />
        </svg>
      );
    case 'today':
      return (
        <svg {...p}>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M4 9h16M8 3v4M16 3v4" />
        </svg>
      );
    case 'map':
      return (
        <svg {...p}>
          <path d="M9 4L4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...p}>
          <path d="M12 3c1 3-2 4-2 7a2 2 0 004 0c0-1 1-1 1 0a5 5 0 11-8.5-3.5C8 11 9 6 12 3z" />
        </svg>
      );
    case 'volume':
      return (
        <svg {...p}>
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path d="M17 8a5 5 0 010 8" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'headset':
      return (
        <svg {...p}>
          <path d="M4 13v-1a8 8 0 0116 0v1" />
          <rect x="3" y="13" width="4" height="6" rx="1.5" />
          <rect x="17" y="13" width="4" height="6" rx="1.5" />
          <path d="M19 19a4 4 0 01-4 3h-2" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...p}>
          <path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
        </svg>
      );
    default:
      return null;
  }
}
