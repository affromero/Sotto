'use client';

import { useState } from 'react';
import { ReportQueue } from './ReportQueue';
import { ModerationLog } from './ModerationLog';
import { VoiceModeration } from './VoiceModeration';
import styles from './page.module.css';

interface ModerationTabsProps {
  pendingReportCount: number;
  failedPodcastCount: number;
  feedbackCount: number;
  pendingVoiceCount: number;
  failedPodcastsContent: React.ReactNode;
  feedbackContent: React.ReactNode;
}

type TabId = 'reports' | 'log' | 'failed' | 'feedback' | 'voices';

interface Tab {
  id: TabId;
  label: string;
  count?: number;
}

export function ModerationTabs({
  pendingReportCount,
  failedPodcastCount,
  feedbackCount,
  pendingVoiceCount,
  failedPodcastsContent,
  feedbackContent,
}: ModerationTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('reports');

  const tabs: Tab[] = [
    { id: 'reports', label: 'Reports', count: pendingReportCount },
    { id: 'log', label: 'Moderation Log' },
    { id: 'failed', label: 'Failed Podcasts', count: failedPodcastCount },
    { id: 'feedback', label: 'Feedback', count: feedbackCount },
    { id: 'voices', label: 'Voices', count: pendingVoiceCount },
  ];

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Moderation sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            type="button"
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={styles.tabBadge}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      <div
        id={`panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={activeTab}
        className={styles.tabPanel}
      >
        {activeTab === 'reports' && <ReportQueue />}
        {activeTab === 'log' && <ModerationLog />}
        {activeTab === 'failed' && failedPodcastsContent}
        {activeTab === 'feedback' && feedbackContent}
        {activeTab === 'voices' && <VoiceModeration />}
      </div>
    </>
  );
}
