'use client';

import { useState } from 'react';
import { AnalyticsSection } from './AnalyticsSection';
import { AutoTweetSection } from './AutoTweetSection';
import { TrendsSection } from './TrendsSection';
import { ThreadSection } from './ThreadSection';
import styles from './TwitterDashboard.module.css';

type TabId = 'analytics' | 'auto-tweet' | 'trends' | 'thread';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'auto-tweet', label: 'Auto-Tweet' },
  { id: 'trends', label: 'Trends' },
  { id: 'thread', label: 'Thread → Podcast' },
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
        <div role="tabpanel" hidden={activeTab !== 'auto-tweet'}>
          <AutoTweetSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'trends'}>
          <TrendsSection />
        </div>
        <div role="tabpanel" hidden={activeTab !== 'thread'}>
          <ThreadSection />
        </div>
      </div>
    </div>
  );
}
