'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Focus, Pause, Play, RotateCcw } from 'lucide-react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { MemoryNodeDetail } from './MemoryNodeDetail';
import styles from './MemoryGraph.module.css';

// Register fcose once at module scope, guard against double-registration.
let fcoseRegistered = false;
if (!fcoseRegistered) {
  cytoscape.use(fcose);
  fcoseRegistered = true;
}

// Brand color literals. Cytoscape styles its own <canvas> via JS.
// This is an accepted, documented exception to the CSS-Modules-only rule.
const COLOR_VOCAB = '#3F4FB0';
const COLOR_GRAMMAR = '#2A3550';
const COLOR_WEAK = '#C2410C';
const COLOR_STRONG = '#147D64';
const COLOR_DUE = '#DC2626';
const COLOR_EDGE = '#BFC4D6';
const COLOR_EDGE_HOT = '#7E89C7';
const COLOR_LABEL = '#1E2128';
const COLOR_BG = '#F5F4F0';
const COLOR_NODE_BORDER = '#EEF0F6';

const MAX_NODES = 520;
const MIN_NODE_SIZE = 24;
const MAX_NODE_SIZE = 68;
const PLAYBACK_MS = 900;

export interface MemoryNode {
  id: string;
  kind: 'vocab' | 'grammar';
  label: string;
  translation?: string;
  strength: number;
  due: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  dueAt?: string | null;
  lastReviewed?: string | null;
  cefrLevel?: string | null;
  reviewCount?: number;
  lapseCount?: number;
  partOfSpeech?: string | null;
  pronunciation?: string | null;
  topicKey?: string;
}

export interface MemoryEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  createdAt?: string | null;
}

export interface MemoryGraphData {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

interface MemoryGraphProps {
  graph: MemoryGraphData;
  courseId?: string;
  courseTitle?: string;
}

type StrengthFilter = 'all' | 'weak' | 'due' | 'strong';
type KindFilter = 'all' | 'vocab' | 'grammar';
type LayoutMode = 'constellation' | 'levels';

interface TimelinePoint {
  label: string;
  cutoff: number;
  total: number;
  added: number;
}

interface GraphStats {
  total: number;
  vocab: number;
  grammar: number;
  weak: number;
  due: number;
  strong: number;
  average: number;
}

function getNodeTime(node: MemoryNode): number {
  const createdAt = node.createdAt ? Date.parse(node.createdAt) : NaN;
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function dateKey(ms: number): string {
  if (ms <= 0) return 'Unknown';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

function shortDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return 'Never';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(ms));
}

function masteryTone(node: MemoryNode): 'weak' | 'due' | 'building' | 'strong' {
  if (node.due) return 'due';
  if (node.strength < 0.45 || (node.lapseCount ?? 0) >= 2) return 'weak';
  if (node.strength >= 0.78) return 'strong';
  return 'building';
}

function nodeColor(node: MemoryNode): string {
  const tone = masteryTone(node);
  if (tone === 'weak' || tone === 'due') return COLOR_WEAK;
  if (tone === 'strong') return COLOR_STRONG;
  return node.kind === 'vocab' ? COLOR_VOCAB : COLOR_GRAMMAR;
}

function buildTimeline(nodes: MemoryNode[]): TimelinePoint[] {
  if (nodes.length === 0) return [];

  const times = nodes
    .map(getNodeTime)
    .filter((time) => time > 0)
    .sort((a, b) => a - b);

  if (times.length === 0) {
    return [
      { label: 'Now', cutoff: Number.MAX_SAFE_INTEGER, total: nodes.length, added: nodes.length },
    ];
  }

  const buckets = new Map<string, { cutoff: number; added: number }>();
  for (const time of times) {
    const start = new Date(time);
    start.setHours(0, 0, 0, 0);
    const key = start.toISOString();
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const existing = buckets.get(key);
    buckets.set(key, {
      cutoff: end.getTime(),
      added: (existing?.added ?? 0) + 1,
    });
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([, bucket], index, all) => ({
      label: dateKey(bucket.cutoff),
      cutoff: bucket.cutoff,
      added: bucket.added,
      total: all.slice(0, index + 1).reduce((sum, [, item]) => sum + item.added, 0),
    }));

  const first = points[0];
  return [{ label: 'Origin', cutoff: first.cutoff - 86_400_000, total: 0, added: 0 }, ...points];
}

function computeStats(nodes: MemoryNode[]): GraphStats {
  const total = nodes.length;
  if (total === 0) {
    return { total: 0, vocab: 0, grammar: 0, weak: 0, due: 0, strong: 0, average: 0 };
  }

  const sum = nodes.reduce((acc, node) => acc + node.strength, 0);
  return {
    total,
    vocab: nodes.filter((node) => node.kind === 'vocab').length,
    grammar: nodes.filter((node) => node.kind === 'grammar').length,
    weak: nodes.filter((node) => masteryTone(node) === 'weak' || masteryTone(node) === 'due')
      .length,
    due: nodes.filter((node) => node.due).length,
    strong: nodes.filter((node) => masteryTone(node) === 'strong').length,
    average: Math.round((sum / total) * 100),
  };
}

function strengthLabel(node: MemoryNode): string {
  const percent = Math.round(node.strength * 100);
  if (node.due) return `${percent}% / due`;
  if (node.strength < 0.45) return `${percent}% / weak`;
  if (node.strength >= 0.78) return `${percent}% / strong`;
  return `${percent}%`;
}

function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'memory-graph'
  );
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function MemoryGraph({ graph, courseId, courseTitle = 'memory graph' }: MemoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('constellation');
  const [labelsVisible, setLabelsVisible] = useState(false);
  const [timelineState, setTimelineState] = useState<{ signature: string; index: number | null }>({
    signature: '',
    index: null,
  });
  const [playing, setPlaying] = useState(false);

  const timeline = useMemo(() => buildTimeline(graph.nodes), [graph.nodes]);
  const graphSignature = useMemo(
    () => graph.nodes.map((node) => `${node.id}:${node.createdAt ?? ''}`).join('|'),
    [graph.nodes]
  );

  const timelineIndex = timelineState.signature === graphSignature ? timelineState.index : null;
  const activeTimelineIndex =
    timeline.length === 0
      ? null
      : Math.min(timelineIndex ?? timeline.length - 1, timeline.length - 1);
  const activePoint = activeTimelineIndex == null ? null : timeline[activeTimelineIndex];
  const playbackActive = playing && timelineState.signature === graphSignature;

  const nodesByTimeline = useMemo(() => {
    if (!activePoint) return graph.nodes;
    return graph.nodes.filter((node) => getNodeTime(node) <= activePoint.cutoff);
  }, [activePoint, graph.nodes]);

  const nodesByFilter = useMemo(() => {
    return nodesByTimeline.filter((node) => {
      if (kindFilter !== 'all' && node.kind !== kindFilter) return false;
      if (strengthFilter === 'weak')
        return masteryTone(node) === 'weak' || masteryTone(node) === 'due';
      if (strengthFilter === 'due') return node.due;
      if (strengthFilter === 'strong') return masteryTone(node) === 'strong';
      return true;
    });
  }, [kindFilter, nodesByTimeline, strengthFilter]);

  const isTruncated = nodesByFilter.length > MAX_NODES;
  const visibleNodes = useMemo(() => {
    if (!isTruncated) return nodesByFilter;
    return [...nodesByFilter]
      .sort((a, b) => {
        if (a.due !== b.due) return a.due ? -1 : 1;
        return a.strength - b.strength;
      })
      .slice(0, MAX_NODES);
  }, [isTruncated, nodesByFilter]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [graph.edges, visibleIds]
  );

  const currentStats = useMemo(() => computeStats(nodesByTimeline), [nodesByTimeline]);
  const filteredStats = useMemo(() => computeStats(nodesByFilter), [nodesByFilter]);

  const weakNodes = useMemo(
    () =>
      [...nodesByTimeline]
        .filter((node) => masteryTone(node) === 'weak' || masteryTone(node) === 'due')
        .sort((a, b) => {
          if (a.due !== b.due) return a.due ? -1 : 1;
          return a.strength - b.strength;
        })
        .slice(0, 5),
    [nodesByTimeline]
  );

  const strongNodes = useMemo(
    () =>
      [...nodesByTimeline]
        .filter((node) => masteryTone(node) === 'strong')
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 5),
    [nodesByTimeline]
  );

  useEffect(() => {
    if (!playbackActive || timeline.length <= 1) return;
    const timer = window.setInterval(() => {
      setTimelineState((current) => {
        const index = current.signature === graphSignature ? (current.index ?? 0) : 0;
        if (index >= timeline.length - 1) {
          window.clearInterval(timer);
          setPlaying(false);
          return current;
        }
        return { signature: graphSignature, index: index + 1 };
      });
    }, PLAYBACK_MS);
    return () => window.clearInterval(timer);
  }, [graphSignature, playbackActive, timeline.length]);

  const activeSelectedNode = selectedNode && visibleIds.has(selectedNode.id) ? selectedNode : null;

  const focusNode = useCallback(
    (nodeId: string) => {
      const found = graph.nodes.find((node) => node.id === nodeId) ?? null;
      setSelectedNode(found);
      const cy = cyRef.current;
      if (!cy || !found) return;
      const ele = cy.getElementById(nodeId);
      if (ele.length === 0) return;
      cy.elements().unselect();
      ele.select();
      cy.fit(ele, 140);
    },
    [graph.nodes]
  );

  useEffect(() => {
    if (!containerRef.current || visibleNodes.length === 0) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const elements: cytoscape.ElementDefinition[] = [
      ...visibleNodes.map((node) => {
        const size = MIN_NODE_SIZE + Math.round(node.strength * (MAX_NODE_SIZE - MIN_NODE_SIZE));
        const tone = masteryTone(node);
        return {
          data: {
            id: node.id,
            label: node.label,
            strength: node.strength,
            size,
            nodeColor: nodeColor(node),
            borderColor: node.due
              ? COLOR_DUE
              : tone === 'strong'
                ? COLOR_STRONG
                : COLOR_NODE_BORDER,
            borderWidth: node.due ? 4 : tone === 'weak' ? 3 : 1.5,
          },
          classes: `${tone} ${node.kind}`,
        };
      }),
      ...visibleEdges.map((edge) => ({
        data: {
          id: `${edge.source}-${edge.target}-${edge.type}`,
          source: edge.source,
          target: edge.target,
          weight: edge.weight,
          hot: edge.weight >= 0.85,
        },
      })),
    ];

    const layout =
      layoutMode === 'levels'
        ? ({
            name: 'concentric',
            animate: !prefersReducedMotion,
            animationDuration: prefersReducedMotion ? 0 : 480,
            fit: true,
            padding: 54,
            minNodeSpacing: 56,
            concentric: (node: cytoscape.NodeSingular) => node.data('strength') as number,
            levelWidth: () => 0.22,
          } as Parameters<cytoscape.Core['layout']>[0])
        : ({
            name: 'fcose',
            animate: !prefersReducedMotion,
            animationDuration: prefersReducedMotion ? 0 : 520,
            randomize: false,
            quality: visibleNodes.length > 180 ? 'draft' : 'default',
            nodeSeparation: 92,
            idealEdgeLength: 92,
            nodeRepulsion: 5600,
            gravity: 0.28,
          } as Parameters<cytoscape.Core['layout']>[0]);

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(nodeColor)',
            'border-color': 'data(borderColor)',
            'border-width': 'data(borderWidth)',
            width: 'data(size)',
            height: 'data(size)',
            label: labelsVisible ? 'data(label)' : '',
            'text-valign': 'bottom' as const,
            'text-halign': 'center' as const,
            'font-family': 'IBM Plex Sans, -apple-system, sans-serif',
            'font-size': 10,
            color: COLOR_LABEL,
            'text-outline-width': 3,
            'text-outline-color': COLOR_BG,
            'min-zoomed-font-size': 8,
            'overlay-opacity': 0,
            'transition-property': 'border-width, border-color, background-color',
            'transition-duration': 160,
          },
        },
        {
          selector: 'node.vocab',
          style: {
            shape: 'ellipse',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 5,
            'border-color': COLOR_VOCAB,
            label: 'data(label)',
            'z-index': 20,
            'text-background-color': COLOR_BG,
            'text-background-opacity': 0.88,
            'text-background-padding': '4px',
          },
        },
        {
          selector: 'node.hover',
          style: {
            label: 'data(label)',
            'z-index': 20,
            'text-background-color': COLOR_BG,
            'text-background-opacity': 0.88,
            'text-background-padding': '4px',
          },
        },
        {
          selector: 'node.grammar',
          style: {
            shape: 'round-rectangle',
            'font-size': 9,
          },
        },
        {
          selector: 'node.due',
          style: {
            'border-color': COLOR_DUE,
          },
        },
        {
          selector: 'edge',
          style: {
            width: (ele: cytoscape.EdgeSingular) => Math.max(1, (ele.data('weight') as number) * 3),
            'line-color': COLOR_EDGE,
            'target-arrow-color': COLOR_EDGE,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier' as const,
            opacity: 0.58,
          },
        },
        {
          selector: 'edge[hot]',
          style: {
            'line-color': COLOR_EDGE_HOT,
            'target-arrow-color': COLOR_EDGE_HOT,
            opacity: 0.86,
          },
        },
      ],
      layout,
      minZoom: 0.18,
      maxZoom: 4.2,
      boxSelectionEnabled: false,
      textureOnViewport: visibleNodes.length > 220,
      pixelRatio: visibleNodes.length > 320 ? 1 : 'auto',
    });

    cy.on('tap', 'node', (event) => {
      const nodeId = event.target.id() as string;
      const found = visibleNodes.find((node) => node.id === nodeId) ?? null;
      setSelectedNode(found);
    });

    cy.on('mouseover', 'node', (event) => {
      event.target.addClass('hover');
    });

    cy.on('mouseout', 'node', (event) => {
      event.target.removeClass('hover');
    });

    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [focusNode, labelsVisible, layoutMode, visibleEdges, visibleNodes]);

  function fitGraph() {
    cyRef.current?.fit(undefined, 58);
  }

  function exportPng() {
    const cy = cyRef.current;
    if (!cy || visibleNodes.length === 0) return;
    const png = cy.png({ full: true, scale: 2, bg: COLOR_BG });
    downloadDataUrl(`${safeFilename(courseTitle)}-memory-graph.png`, png);
  }

  function replayTimeline() {
    if (timeline.length <= 1) return;
    setTimelineState({ signature: graphSignature, index: 0 });
    setPlaying(true);
  }

  if (graph.nodes.length === 0) {
    return (
      <div className={styles.empty} role="status" aria-label="Memory graph empty">
        <p className={styles.emptyHeading}>Your memory graph is empty.</p>
        <p className={styles.emptyBody}>Complete a class to start building it.</p>
      </div>
    );
  }

  const maxTimeline = Math.max(0, timeline.length - 1);
  const timelineValue = activeTimelineIndex ?? maxTimeline;
  const visiblePercent =
    currentStats.total === 0 ? 0 : Math.round((filteredStats.total / currentStats.total) * 100);

  return (
    <section className={styles.root} aria-label="Interactive memory graph">
      <div className={styles.commandDeck}>
        <div className={styles.metricRail} aria-label="Memory graph summary">
          <div className={styles.metric}>
            <span className={styles.metricValue}>{currentStats.total}</span>
            <span className={styles.metricLabel}>Nodes</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{currentStats.average}%</span>
            <span className={styles.metricLabel}>Average</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{currentStats.weak}</span>
            <span className={styles.metricLabel}>Weak</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{currentStats.strong}</span>
            <span className={styles.metricLabel}>Strong</span>
          </div>
        </div>

        <div className={styles.controls} aria-label="Graph controls">
          <div className={styles.timelinePanel}>
            <div className={styles.timelineTop}>
              <span className={styles.controlLabel}>Growth</span>
              <span className={styles.timelineDate}>{activePoint?.label ?? 'Now'}</span>
            </div>
            <div className={styles.timelineControls}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  if (playbackActive) {
                    setPlaying(false);
                    return;
                  }
                  if (timelineValue >= maxTimeline) {
                    setTimelineState({ signature: graphSignature, index: 0 });
                  } else {
                    setTimelineState({ signature: graphSignature, index: timelineValue });
                  }
                  setPlaying(true);
                }}
                disabled={timeline.length <= 1}
                aria-label={playbackActive ? 'Pause timeline playback' : 'Play timeline growth'}
                title={playbackActive ? 'Pause' : 'Play'}
              >
                {playbackActive ? (
                  <Pause size={18} aria-hidden="true" />
                ) : (
                  <Play size={18} aria-hidden="true" />
                )}
              </button>
              <input
                className={styles.timelineRange}
                type="range"
                min={0}
                max={maxTimeline}
                value={timelineValue}
                onChange={(event) => {
                  setTimelineState({
                    signature: graphSignature,
                    index: Number(event.target.value),
                  });
                  setPlaying(false);
                }}
                aria-label="Memory graph timeline"
              />
              <button
                type="button"
                className={styles.iconButton}
                onClick={replayTimeline}
                disabled={timeline.length <= 1}
                aria-label="Replay graph growth"
                title="Replay"
              >
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            </div>
            <p className={styles.timelineMeta}>
              {activePoint?.added ? `+${activePoint.added} new` : 'Start'} / {currentStats.vocab}{' '}
              words / {currentStats.grammar} grammar
            </p>
          </div>

          <div className={styles.segmentGroup} aria-label="Filter by mastery">
            {(['all', 'weak', 'due', 'strong'] as StrengthFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                className={`${styles.segmentButton} ${strengthFilter === filter ? styles.segmentButtonActive : ''}`}
                onClick={() => setStrengthFilter(filter)}
                aria-pressed={strengthFilter === filter}
              >
                {filter === 'all' ? 'All' : filter[0].toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>

          <div className={styles.segmentGroup} aria-label="Filter by node type">
            {(['all', 'vocab', 'grammar'] as KindFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                className={`${styles.segmentButton} ${kindFilter === filter ? styles.segmentButtonActive : ''}`}
                onClick={() => setKindFilter(filter)}
                aria-pressed={kindFilter === filter}
              >
                {filter === 'all' ? 'Both' : filter === 'vocab' ? 'Vocab' : 'Grammar'}
              </button>
            ))}
          </div>

          <div className={styles.controlCluster}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={labelsVisible}
                onChange={(event) => setLabelsVisible(event.target.checked)}
              />
              Labels
            </label>
            <select
              className={styles.layoutSelect}
              value={layoutMode}
              onChange={(event) => setLayoutMode(event.target.value as LayoutMode)}
              aria-label="Graph layout"
            >
              <option value="constellation">Constellation</option>
              <option value="levels">Level rings</option>
            </select>
            <button
              type="button"
              className={styles.iconButton}
              onClick={fitGraph}
              disabled={visibleNodes.length === 0}
              aria-label="Fit graph to view"
              title="Fit"
            >
              <Focus size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={exportPng}
              disabled={visibleNodes.length === 0}
              aria-label="Export graph snapshot as PNG"
              title="Export PNG"
            >
              <Download size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className={styles.stage}>
        <div className={styles.canvasShell}>
          <div className={styles.canvasAtmosphere} aria-hidden="true" />
          <div
            ref={containerRef}
            className={styles.canvas}
            aria-label="Vocabulary and grammar memory graph"
            role="img"
          />
          {visibleNodes.length === 0 && (
            <div className={styles.filteredEmpty} role="status">
              <p className={styles.emptyHeading}>No nodes in this view.</p>
              <p className={styles.emptyBody}>Move the timeline forward or clear a filter.</p>
            </div>
          )}

          <div className={styles.stageHud} aria-live="polite">
            <span>{visibleNodes.length} visible</span>
            <span>{visiblePercent}% of this moment</span>
          </div>
        </div>

        <aside className={styles.insightPanel} aria-label="Graph insights">
          <div className={styles.insightBlock}>
            <div className={styles.insightHeader}>
              <h2 className={styles.insightTitle}>Legend</h2>
            </div>
            <ul className={styles.legendList} aria-label="Memory graph legend">
              <li>
                <span className={`${styles.legendDot} ${styles.legendDue}`} aria-hidden="true" />
                <span>Red means due or weak</span>
              </li>
              <li>
                <span className={`${styles.legendDot} ${styles.legendStrong}`} aria-hidden="true" />
                <span>Green means strong</span>
              </li>
              <li>
                <span className={styles.legendShapeRow} aria-hidden="true">
                  <span className={`${styles.legendShape} ${styles.legendVocab}`} />
                  <span className={`${styles.legendShape} ${styles.legendGrammar}`} />
                </span>
                <span>Circle is vocab, square is grammar</span>
              </li>
              <li>
                <span className={styles.legendScale} aria-hidden="true">
                  <span />
                  <span />
                </span>
                <span>Bigger means stronger memory</span>
              </li>
            </ul>
          </div>

          <div className={styles.insightBlock}>
            <div className={styles.insightHeader}>
              <h2 className={styles.insightTitle}>Weak Spots</h2>
              <span className={styles.insightCount}>{currentStats.due} due</span>
            </div>
            {weakNodes.length === 0 ? (
              <p className={styles.insightEmpty}>No weak nodes in this view.</p>
            ) : (
              <ul className={styles.insightList}>
                {weakNodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={styles.insightButton}
                      onClick={() => focusNode(node.id)}
                    >
                      <span className={styles.insightName}>{node.label}</span>
                      <span className={styles.insightMeta}>{strengthLabel(node)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.insightBlock}>
            <div className={styles.insightHeader}>
              <h2 className={styles.insightTitle}>Strengths</h2>
              <span className={styles.insightCount}>{currentStats.strong} solid</span>
            </div>
            {strongNodes.length === 0 ? (
              <p className={styles.insightEmpty}>Strong nodes will appear as mastery grows.</p>
            ) : (
              <ul className={styles.insightList}>
                {strongNodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className={styles.insightButton}
                      onClick={() => focusNode(node.id)}
                    >
                      <span className={styles.insightName}>{node.label}</span>
                      <span className={styles.insightMeta}>{strengthLabel(node)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {isTruncated && (
        <p className={styles.truncationNote} role="note" aria-live="polite">
          Showing {MAX_NODES} priority nodes. {nodesByFilter.length - MAX_NODES} more are hidden.
        </p>
      )}

      {activeSelectedNode && (
        <MemoryNodeDetail
          node={activeSelectedNode}
          courseId={courseId}
          onClose={() => setSelectedNode(null)}
          formatDate={shortDate}
        />
      )}
    </section>
  );
}
