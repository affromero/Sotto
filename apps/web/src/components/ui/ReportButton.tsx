'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { ReportModal } from './ReportModal';
import styles from './ReportButton.module.css';

interface ReportButtonProps {
  targetType: 'podcast' | 'comment' | 'user';
  targetId: string;
  variant?: 'icon' | 'text';
  context?: { isHumanContent?: boolean; source?: string };
}

export function ReportButton({ targetType, targetId, variant = 'text', context }: ReportButtonProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        className={variant === 'icon' ? styles.iconBtn : styles.textBtn}
        onClick={() => setShowModal(true)}
        type="button"
        aria-label="Report"
      >
        <Flag size={14} />
        {variant === 'text' && <span>Report</span>}
      </button>
      {showModal && (
        <ReportModal
          targetType={targetType}
          targetId={targetId}
          onClose={() => setShowModal(false)}
          context={context}
        />
      )}
    </>
  );
}
