'use client';

import { useState } from 'react';
import { Glyph } from '@/components/Glyph';
import { ProviderModelConfig, type ProviderModelConfigProps } from './ProviderModelConfig';
import { ModelTestPanel } from '../models/ModelTestPanel';
import shell from '../../adminTheme.module.css';

type Tab = 'models' | 'test';

interface ProvidersTabsProps {
  autoModels: ProviderModelConfigProps;
  testable: React.ComponentProps<typeof ModelTestPanel>;
}

export function ProvidersTabs({ autoModels, testable }: ProvidersTabsProps) {
  const [tab, setTab] = useState<Tab>('models');

  return (
    <>
      <div className={`${shell.seg} ${shell.subTabs}`} role="tablist" aria-label="Providers sections">
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
          aria-selected={tab === 'test'}
          className={tab === 'test' ? shell.on : ''}
          onClick={() => setTab('test')}
        >
          <Glyph name="spark" size={14} /> Test
        </button>
      </div>

      {tab === 'models' ? <ProviderModelConfig {...autoModels} /> : <ModelTestPanel {...testable} />}
    </>
  );
}
