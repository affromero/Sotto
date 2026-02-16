'use client';

import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { InspireQuiz } from './InspireQuiz';
import styles from './InspireMe.module.css';

interface InspireMeProps {
  open: boolean;
  onClose: () => void;
  onSelectTopic: (topic: string) => void;
}

type Section = 'forYou' | 'trending' | 'news';

const SECTION_LABELS: Record<Section, string> = {
  forYou: 'For You',
  trending: 'Trending',
  news: 'In the News',
};

export function InspireMe({ open, onClose, onSelectTopic }: InspireMeProps) {
  const [activeSection, setActiveSection] = useState<Section>('forYou');

  const handleSelectTopic = (topic: string) => {
    onSelectTopic(topic);
    onClose();
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Inspire Me">
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <h2 className={styles.headerTitle}>Inspire Me</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs} role="tablist" aria-label="Inspiration sections">
          {(Object.keys(SECTION_LABELS) as Section[]).map((section) => (
            <button
              key={section}
              type="button"
              role="tab"
              aria-selected={activeSection === section}
              className={`${styles.tab} ${activeSection === section ? styles.tabActive : ''}`}
              onClick={() => setActiveSection(section)}
            >
              {SECTION_LABELS[section]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={styles.content}>
          <InspireQuiz
            key={activeSection}
            section={activeSection}
            onSelectTopic={handleSelectTopic}
          />
        </div>
      </div>
    </div>
  );
}
