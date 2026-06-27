'use client';

import { useState } from 'react';
import { Glyph } from '@/components/Glyph';
import { AiProviderCards } from '@/components/settings/AiProviderCards';
import { TtsProviderCards } from '@/components/settings/TtsProviderCards';
import type { AiProviderClientMeta } from '@/lib/providers/ai-registry';
import type { TtsProviderClientMeta } from '@/lib/providers/tts-registry';
import { ProviderModelConfig, type ProviderModelConfigProps } from './ProviderModelConfig';
import { ModelTestPanel } from '../models/ModelTestPanel';
import shell from '../../adminTheme.styles';

type Tab = 'models' | 'keys' | 'test';

interface ProviderKeyConfigProps {
  configuredAiProviders: Array<{ provider: string; isValid: boolean }>;
  configuredTtsProviders: Array<{ provider: string; isValid: boolean }>;
  aiProviderMeta: AiProviderClientMeta[];
  ttsProviderMeta: TtsProviderClientMeta[];
  aiSystemProviders: Array<{ id: string; label: string; description: string; available: boolean }>;
}

interface ProvidersTabsProps {
  autoModels: ProviderModelConfigProps;
  keys: ProviderKeyConfigProps;
  testable: React.ComponentProps<typeof ModelTestPanel>;
}

function ProviderKeyConfig({
  configuredAiProviders,
  configuredTtsProviders,
  aiProviderMeta,
  ttsProviderMeta,
  aiSystemProviders,
}: ProviderKeyConfigProps) {
  return (
    <div className={shell.panel2col}>
      <div className={shell.panel}>
        <div className={shell.panelHead}>
          <span className={shell.phTitle}>
            <Glyph name="spark" size={15} /> AI provider keys
          </span>
        </div>
        <div className={shell.panelBody}>
          <p className={shell.sectionLede}>
            Store encrypted keys for lesson generation, Q&amp;A, live translation, and admin model
            tests.
          </p>
          <AiProviderCards
            initialConfigured={configuredAiProviders}
            providerMeta={aiProviderMeta}
            systemProviders={aiSystemProviders}
          />
        </div>
      </div>

      <div className={shell.panel}>
        <div className={shell.panelHead}>
          <span className={shell.phTitle}>
            <Glyph name="volume" size={15} /> Speech provider keys
          </span>
        </div>
        <div className={shell.panelBody}>
          <p className={shell.sectionLede}>
            Store encrypted keys for TTS, shared STT providers, voice previews, and speech practice.
          </p>
          <TtsProviderCards
            initialConfigured={configuredTtsProviders}
            providerMeta={ttsProviderMeta}
          />
        </div>
      </div>
    </div>
  );
}

export function ProvidersTabs({ autoModels, keys, testable }: ProvidersTabsProps) {
  const [tab, setTab] = useState<Tab>('models');

  return (
    <>
      <div
        className={`${shell.seg} ${shell.subTabs}`}
        role="tablist"
        aria-label="Providers sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'models'}
          className={tab === 'models' ? shell.on : ''}
          onClick={() => setTab('models')}
        >
          <Glyph name="gear" size={14} /> Models
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'keys'}
          className={tab === 'keys' ? shell.on : ''}
          onClick={() => setTab('keys')}
        >
          <Glyph name="lock" size={14} /> Keys
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'test'}
          className={tab === 'test' ? shell.on : ''}
          onClick={() => setTab('test')}
        >
          <Glyph name="spark" size={14} /> Test
        </button>
      </div>

      {tab === 'models' ? (
        <ProviderModelConfig {...autoModels} />
      ) : tab === 'keys' ? (
        <ProviderKeyConfig {...keys} />
      ) : (
        <ModelTestPanel {...testable} />
      )}
    </>
  );
}
