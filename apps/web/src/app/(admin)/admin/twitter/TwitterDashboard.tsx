'use client';

import { useState } from 'react';
import { AnalyticsSection } from './AnalyticsSection';
import { MentionsSection } from './MentionsSection';
import { AutoTweetSection } from './AutoTweetSection';
import { TrendsSection } from './TrendsSection';
import { ThreadSection } from './ThreadSection';
import { SettingsSection } from './SettingsSection';
import styles from './TwitterDashboard.module.css';

type TabId = 'analytics' | 'mentions' | 'auto-tweet' | 'trends' | 'thread' | 'settings';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'auto-tweet', label: 'Auto-Tweet' },
  { id: 'trends', label: 'Trends' },
  { id: 'thread', label: 'Thread → Podcast' },
  { id: 'settings', label: 'Settings' },
];

export function TwitterDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('analytics');

  return (
    <div className={styles.dashboard}>
      <nav className={styles.tabs} role="tablist" aria-label="Twitter dashboard sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            type="button"
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className={styles.content}>
        <div role="tabpanel" hidden={activeTab !== 'analytics'}>
          <AnalyticsSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'mentions'}>
          <MentionsSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'auto-tweet'}>
          <AutoTweetSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'trends'}>
          <TrendsSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'thread'}>
          <ThreadSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'settings'}>
          <SettingsSection />
        </div>
      </div>
    </div>
  );
}
