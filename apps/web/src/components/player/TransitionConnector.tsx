'use client';

import { useCallback } from 'react';
import type { PipelineTransition, FalVideoModelInfo } from '@/types/pipeline';
import { videoModelSupportsLastFrame } from '@/lib/providers/video-registry';
import { formatCost } from '@/lib/video-cost-estimator';
import styles from './TransitionConnector.module.css';

interface TransitionConnectorProps {
  transition: PipelineTransition;
  videoModels: FalVideoModelInfo[];
  onUpdate: (fromOrder: number, toOrder: number, updates: Partial<PipelineTransition>) => void;
}

export function TransitionConnector({ transition, videoModels, onUpdate }: TransitionConnectorProps) {
  const handleToggle = useCallback(() => {
    onUpdate(transition.fromSegmentOrder, transition.toSegmentOrder, {
      enabled: !transition.enabled,
    });
  }, [transition.fromSegmentOrder, transition.toSegmentOrder, transition.enabled, onUpdate]);

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdate(transition.fromSegmentOrder, transition.toSegmentOrder, {
        transitionModel: e.target.value || null,
      });
    },
    [transition.fromSegmentOrder, transition.toSegmentOrder, onUpdate],
  );

  const flf2vWarning = transition.transitionModel && !videoModelSupportsLastFrame(transition.transitionModel);

  return (
    <div className={`${styles.root} ${transition.enabled ? styles.enabled : styles.disabled}`}>
      <div className={styles.line} />
      <div className={styles.content}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={transition.enabled}
            onChange={handleToggle}
            className={styles.checkbox}
          />
          <span className={styles.toggleLabel}>Transition</span>
          {transition.recommended && (
            <span className={styles.badge} title={transition.recommendationReason}>AI</span>
          )}
        </label>

        {transition.enabled && (
          <div className={styles.details}>
            <select
              className={styles.modelSelect}
              value={transition.transitionModel ?? ''}
              onChange={handleModelChange}
            >
              <option value="">No model</option>
              {videoModels.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName}
                </option>
              ))}
            </select>
            {flf2vWarning && (
              <span className={styles.warning} title="This model may not support first+last frame video generation">
                ⚠
              </span>
            )}
            <span className={styles.cost}>{formatCost(transition.estimatedCost)}</span>
          </div>
        )}
      </div>
      <div className={styles.line} />
    </div>
  );
}
