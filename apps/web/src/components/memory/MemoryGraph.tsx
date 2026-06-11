'use client';

import { useEffect, useRef, useState } from 'react';
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

// Brand color literals — Cytoscape styles its own <canvas> via JS.
// This is an accepted, documented exception to the CSS-Modules-only rule.
const COLOR_VOCAB = '#3F4FB0';   // Aula Indigo
const COLOR_GRAMMAR = '#2A3550'; // Aula Slate
const COLOR_DUE_BORDER = '#DC2626';
const COLOR_NORMAL_BORDER = '#E2E4EC';
const COLOR_EDGE = '#C7C9D4';
const COLOR_LABEL = '#1E2128';
const COLOR_BG = '#F5F4F0';

const MAX_NODES = 400;
const MIN_NODE_SIZE = 22;
const MAX_NODE_SIZE = 60;

export interface MemoryNode {
  id: string;
  kind: 'vocab' | 'grammar';
  label: string;
  translation?: string;
  strength: number;
  due: boolean;
}

export interface MemoryEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface MemoryGraphData {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

interface MemoryGraphProps {
  graph: MemoryGraphData;
}

export function MemoryGraph({ graph }: MemoryGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);

  const totalNodes = graph.nodes.length;
  const isTruncated = totalNodes > MAX_NODES;

  // Sort: prioritise due nodes first, then by strength descending.
  const visibleNodes = isTruncated
    ? [...graph.nodes]
        .sort((a, b) => {
          if (a.due !== b.due) return a.due ? -1 : 1;
          return b.strength - a.strength;
        })
        .slice(0, MAX_NODES)
    : graph.nodes;

  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = graph.edges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  );

  useEffect(() => {
    if (!containerRef.current || visibleNodes.length === 0) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const elements: cytoscape.ElementDefinition[] = [
      ...visibleNodes.map((n) => {
        const size =
          MIN_NODE_SIZE +
          Math.round(n.strength * (MAX_NODE_SIZE - MIN_NODE_SIZE));
        return {
          data: {
            id: n.id,
            label: n.label,
            size,
            nodeColor: n.kind === 'vocab' ? COLOR_VOCAB : COLOR_GRAMMAR,
            borderColor: n.due ? COLOR_DUE_BORDER : COLOR_NORMAL_BORDER,
            borderWidth: n.due ? 3 : 1.5,
          },
        };
      }),
      ...visibleEdges.map((e) => ({
        data: {
          id: `${e.source}-${e.target}-${e.type}`,
          source: e.source,
          target: e.target,
          weight: e.weight,
        },
      })),
    ];

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
            label: 'data(label)',
            'text-valign': 'bottom' as const,
            'text-halign': 'center' as const,
            'font-family': 'IBM Plex Sans, -apple-system, sans-serif',
            'font-size': 10,
            color: COLOR_LABEL,
            'text-outline-width': 2,
            'text-outline-color': COLOR_BG,
            'min-zoomed-font-size': 8,
            'overlay-padding': 4,
            'transition-property': 'border-width, border-color',
            'transition-duration': 150,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': COLOR_VOCAB,
          },
        },
        {
          selector: 'edge',
          style: {
            width: (ele: cytoscape.EdgeSingular) =>
              Math.max(1, (ele.data('weight') as number) * 3),
            'line-color': COLOR_EDGE,
            'curve-style': 'bezier' as const,
            opacity: 0.7,
          },
        },
      ],
      layout: {
        name: 'fcose',
        animate: !prefersReducedMotion,
        animationDuration: prefersReducedMotion ? 0 : 400,
        randomize: false,
        quality: 'default' as const,
        nodeSeparation: 75,
        idealEdgeLength: 80,
        nodeRepulsion: 4500,
      } as Parameters<cytoscape.Core['layout']>[0],
      wheelSensitivity: 0.3,
      minZoom: 0.2,
      maxZoom: 4,
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (event) => {
      const nodeId = event.target.id() as string;
      const found = visibleNodes.find((n) => n.id === nodeId) ?? null;
      setSelectedNode(found);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div className={styles.empty} role="status" aria-label="Memory graph empty">
        <p className={styles.emptyHeading}>Your memory graph is empty.</p>
        <p className={styles.emptyBody}>
          Complete a class to start building it.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div
        ref={containerRef}
        className={styles.canvas}
        aria-label="Vocabulary and grammar memory graph"
        role="img"
      />

      {isTruncated && (
        <p className={styles.truncationNote} role="note" aria-live="polite">
          Showing the {MAX_NODES} strongest/due nodes — {totalNodes - MAX_NODES} more
          are hidden.
        </p>
      )}

      {selectedNode && (
        <MemoryNodeDetail
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
