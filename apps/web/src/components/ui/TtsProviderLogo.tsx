/**
 * SVG logos for TTS provider companies.
 * Used in settings BYOK cards, landing page, and generation flow.
 */

interface TtsProviderLogoProps {
  provider: 'elevenlabs' | 'openai' | 'cartesia' | 'hume' | 'fal' | 'replicate' | 'minimax' | 'mistral' | 'kokoro' | 'anthropic' | 'google' | 'together' | 'deepgram' | 'assemblyai';
  size?: number;
  className?: string;
}

export function TtsProviderLogo({ provider, size = 24, className }: TtsProviderLogoProps) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    className,
    'aria-label': `${PROVIDER_NAMES[provider]} logo`,
    role: 'img' as const,
  };

  switch (provider) {
    case 'elevenlabs':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#1A1A2E" />
          <path d="M8 6v12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M12 6v12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M16 6v12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case 'openai':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#000" />
          <path
            d="M12 4.5c-1.5 0-2.8.7-3.6 1.7C7.2 6.5 6.3 7.5 6.3 8.8c0 .9.3 1.7.8 2.3-.5.6-.8 1.4-.8 2.3 0 1.3.9 2.3 2.1 2.6.8 1 2.1 1.7 3.6 1.7s2.8-.7 3.6-1.7c1.2-.3 2.1-1.3 2.1-2.6 0-.9-.3-1.7-.8-2.3.5-.6.8-1.4.8-2.3 0-1.3-.9-2.3-2.1-2.6C14.8 5.2 13.5 4.5 12 4.5z"
            stroke="#fff"
            strokeWidth="1.2"
          />
        </svg>
      );
    case 'cartesia':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#0F172A" />
          <circle cx="12" cy="12" r="5" stroke="#38BDF8" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2" fill="#38BDF8" />
          <path
            d="M12 3v4M12 17v4M3 12h4M17 12h4"
            stroke="#38BDF8"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'hume':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#FF6B35" />
          <path
            d="M7 9c0-1.7 1.3-3 3-3h4c1.7 0 3 1.3 3 3v6c0 1.7-1.3 3-3 3h-4c-1.7 0-3-1.3-3-3V9z"
            stroke="#fff"
            strokeWidth="1.5"
          />
          <circle cx="10" cy="11" r="1" fill="#fff" />
          <circle cx="14" cy="11" r="1" fill="#fff" />
          <path
            d="M10 14.5c.4.3 1.2.5 2 .5s1.6-.2 2-.5"
            stroke="#fff"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'fal':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#6366F1" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="sans-serif">fal</text>
        </svg>
      );
    case 'replicate':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#262626" />
          <path d="M8 7h8v2H8zM8 11h6v2H8zM8 15h8v2H8z" fill="#fff" />
        </svg>
      );
    case 'minimax':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#1A1A2E" />
          <text x="12" y="16" textAnchor="middle" fill="#4FC3F7" fontSize="8" fontWeight="700" fontFamily="sans-serif">MM</text>
        </svg>
      );
    case 'mistral':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#FF7000" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="sans-serif">M</text>
        </svg>
      );
    case 'anthropic':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#D4A574" />
          <path
            d="M12 5l-5.5 14h2.8l1.1-3h7.2l1.1 3h2.8L12 5zm-0.6 8.5L12 11l.6 2.5h-1.2z"
            fill="#3D2B1F"
          />
        </svg>
      );
    case 'google':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#4285F4" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="sans-serif">G</text>
        </svg>
      );
    case 'together':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#0EA5E9" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="sans-serif">T</text>
        </svg>
      );
    case 'deepgram':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#13EF93" />
          <path d="M8 8h8v2H8zM8 12h6v2H8zM8 16h4v2H8z" fill="#000" />
        </svg>
      );
    case 'assemblyai':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#1651F5" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="sans-serif">AI</text>
        </svg>
      );
    case 'kokoro':
      return (
        <svg {...props}>
          <rect width="24" height="24" rx="4" fill="#1E3A5F" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="sans-serif">K</text>
        </svg>
      );
    default:
      return null;
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  cartesia: 'Cartesia',
  hume: 'Hume AI',
  fal: 'Fal',
  replicate: 'Replicate',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  kokoro: 'Kokoro',
  anthropic: 'Anthropic',
  google: 'Google',
  together: 'Together AI',
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
};

/**
 * Render a row of all provider logos — for the landing page "powered by" section.
 */
export function TtsProviderLogoRow({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const providers = ['elevenlabs', 'openai', 'cartesia', 'hume', 'fal', 'replicate'] as const;
  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
    >
      {providers.map((p) => (
        <TtsProviderLogo key={p} provider={p} size={size} />
      ))}
    </div>
  );
}
