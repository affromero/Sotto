'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SegmentNode, type SegmentNodeData } from './SegmentNode';
import type { VideoPipeline, PipelineSegmentNode, FalModelsResponse } from '@/types/pipeline';
import { estimateSegmentCost, estimatePipelineCost, formatCost } from '@/lib/video-cost-estimator';
import { getSpeakerIndex, getUniqueSpeakers } from '@/lib/speaker-colors';
import styles from './PipelineEditor.module.css';

interface PipelineEditorProps {
  podcastId: string;
  podcastTitle: string;
  pipeline: VideoPipeline;
  falModels: FalModelsResponse;
  onApprove: (pipeline: VideoPipeline) => void;
  onCancel: () => void;
}

const nodeTypes: NodeTypes = { segment: SegmentNode as NodeTypes[string] };

const NODE_Y_GAP = 180;
const SEGMENT_X = 400;
const SOURCE_X = 50;
const OUTPUT_X = 820;

export function PipelineEditor({ podcastTitle, pipeline, falModels, onApprove, onCancel }: PipelineEditorProps) {
  const [segments, setSegments] = useState<PipelineSegmentNode[]>(pipeline.segments);

  const allSpeakers = useMemo(() => getUniqueSpeakers(segments), [segments]);
  const totalCost = useMemo(
    () => estimatePipelineCost(segments, falModels.imageModels, falModels.videoModels),
    [segments, falModels.imageModels, falModels.videoModels],
  );

  const handleSegmentUpdate = useCallback(
    (segmentId: string, updates: Partial<PipelineSegmentNode>) => {
      setSegments((prev) =>
        prev.map((seg) => {
          if (seg.segmentId !== segmentId) return seg;
          const updated = { ...seg, ...updates };
          updated.estimatedCost = estimateSegmentCost(updated, falModels.imageModels, falModels.videoModels);
          return updated;
        }),
      );
    },
    [falModels.imageModels, falModels.videoModels],
  );

  const handleApprove = useCallback(() => {
    onApprove({
      ...pipeline,
      segments,
      totalEstimatedCost: estimatePipelineCost(segments, falModels.imageModels, falModels.videoModels),
    });
  }, [pipeline, segments, onApprove, falModels.imageModels, falModels.videoModels]);

  const totalHeight = Math.max(segments.length * NODE_Y_GAP, 400);
  const centerY = totalHeight / 2;

  const nodes: Node[] = useMemo(() => {
    const result: Node[] = [
      {
        id: 'source',
        type: 'default',
        position: { x: SOURCE_X, y: centerY - 40 },
        data: { label: `${podcastTitle}\n${segments.length} segments` },
        style: {
          background: '#1e3a5f',
          color: '#e0e0e0',
          border: '1px solid #2d5a8a',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '13px',
          width: 200,
          textAlign: 'center' as const,
        },
        draggable: true,
        selectable: false,
      },
    ];

    segments.forEach((seg, i) => {
      const speakerIdx = getSpeakerIndex(seg.speaker, allSpeakers);
      result.push({
        id: `segment-${seg.segmentId}`,
        type: 'segment',
        position: { x: SEGMENT_X, y: i * NODE_Y_GAP },
        data: {
          segment: seg,
          speakerIndex: speakerIdx,
          imageModels: falModels.imageModels,
          videoModels: falModels.videoModels,
          hasFalKey: falModels.hasFalKey,
          onUpdate: handleSegmentUpdate,
        } satisfies SegmentNodeData,
        draggable: true,
      });
    });

    result.push({
      id: 'output',
      type: 'default',
      position: { x: OUTPUT_X, y: centerY - 40 },
      data: { label: `Total: ${formatCost(totalCost)}` },
      style: {
        background: '#1a1a1a',
        color: '#4ade80',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '12px 16px',
        fontSize: '16px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono, monospace)',
        width: 180,
        textAlign: 'center' as const,
      },
      draggable: true,
      selectable: false,
    });

    return result;
  }, [segments, allSpeakers, falModels, handleSegmentUpdate, podcastTitle, centerY, totalCost]);

  const edges: Edge[] = useMemo(() => {
    const result: Edge[] = [];
    segments.forEach((seg) => {
      result.push({
        id: `source-${seg.segmentId}`,
        source: 'source',
        target: `segment-${seg.segmentId}`,
        style: { stroke: '#444', strokeWidth: 1 },
        animated: false,
      });
      result.push({
        id: `${seg.segmentId}-output`,
        source: `segment-${seg.segmentId}`,
        target: 'output',
        style: { stroke: '#444', strokeWidth: 1 },
        animated: false,
      });
    });
    return result;
  }, [segments]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <h3 className={styles.title}>Pipeline Editor</h3>
        <div className={styles.toolbarRight}>
          <span className={styles.totalCost}>{formatCost(totalCost)}</span>
          <button className={styles.cancelBtn} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.approveBtn} onClick={handleApprove} type="button">
            Approve &amp; Render
          </button>
        </div>
      </div>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
