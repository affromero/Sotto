'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './ForkGraph.module.css';

interface ForkGraphProps {
  ancestors: Array<{
    id: string;
    title: string;
    user: { name: string | null; handle: string | null };
  }>;
  current: {
    id: string;
    title: string;
    user: { name: string | null; handle: string | null };
  };
  forks: Array<{
    id: string;
    title: string;
    user: { name: string | null; handle: string | null };
  }>;
}

interface Node {
  id: string;
  title: string;
  user: string;
  x: number;
  y: number;
  type: 'ancestor' | 'current' | 'fork';
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

export function ForkGraph({ ancestors, current, forks }: ForkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        setDimensions({ width, height: Math.max(400, width * 0.5) });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const isMobile = dimensions.width < 768;
  const nodeWidth = isMobile ? 140 : 180;
  const nodeHeight = isMobile ? 60 : 70;
  const verticalSpacing = isMobile ? 100 : 120;
  const horizontalSpacing = isMobile ? 180 : 220;

  // Limit displayed nodes
  const displayAncestors = ancestors.slice(-3);
  const displayForks = forks.slice(0, 5);

  // Build node layout
  const nodes: Node[] = [];
  const baseY = verticalSpacing;

  // Ancestors (vertical chain)
  displayAncestors.forEach((ancestor, index) => {
    const userName = ancestor.user.name || ancestor.user.handle || 'Anonymous';
    nodes.push({
      id: ancestor.id,
      title: truncate(ancestor.title, 30),
      user: userName,
      x: dimensions.width / 2,
      y: baseY + index * verticalSpacing,
      type: 'ancestor',
    });
  });

  // Current node
  const currentY =
    displayAncestors.length > 0 ? baseY + displayAncestors.length * verticalSpacing : baseY;
  const currentUserName = current.user.name || current.user.handle || 'Anonymous';
  nodes.push({
    id: current.id,
    title: truncate(current.title, 30),
    user: currentUserName,
    x: dimensions.width / 2,
    y: currentY,
    type: 'current',
  });

  // Forks (spread horizontally below current)
  const forksY = currentY + verticalSpacing;
  const totalForksWidth = (displayForks.length - 1) * horizontalSpacing;
  const forksStartX = (dimensions.width - totalForksWidth) / 2;

  displayForks.forEach((fork, index) => {
    const userName = fork.user.name || fork.user.handle || 'Anonymous';
    nodes.push({
      id: fork.id,
      title: truncate(fork.title, 30),
      user: userName,
      x: forksStartX + index * horizontalSpacing,
      y: forksY,
      type: 'fork',
    });
  });

  // Calculate edges (smooth bezier curves)
  const edges: Array<{ from: Node; to: Node; path: string }> = [];

  // Connect ancestors to each other
  for (let i = 0; i < displayAncestors.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const controlPointOffset = (to.y - from.y) / 2;
    const path = `M ${from.x} ${from.y + nodeHeight / 2}
                  C ${from.x} ${from.y + nodeHeight / 2 + controlPointOffset},
                    ${to.x} ${to.y - nodeHeight / 2 - controlPointOffset},
                    ${to.x} ${to.y - nodeHeight / 2}`;
    edges.push({ from, to, path });
  }

  // Connect last ancestor to current
  if (displayAncestors.length > 0) {
    const lastAncestor = nodes[displayAncestors.length - 1];
    const currentNode = nodes.find((n) => n.type === 'current')!;
    const controlPointOffset = (currentNode.y - lastAncestor.y) / 2;
    const path = `M ${lastAncestor.x} ${lastAncestor.y + nodeHeight / 2}
                  C ${lastAncestor.x} ${lastAncestor.y + nodeHeight / 2 + controlPointOffset},
                    ${currentNode.x} ${currentNode.y - nodeHeight / 2 - controlPointOffset},
                    ${currentNode.x} ${currentNode.y - nodeHeight / 2}`;
    edges.push({ from: lastAncestor, to: currentNode, path });
  }

  // Connect current to forks
  const currentNode = nodes.find((n) => n.type === 'current')!;
  displayForks.forEach((_, index) => {
    const forkNode = nodes.find((n) => n.type === 'fork' && n.id === displayForks[index].id)!;
    const controlPointOffset = (forkNode.y - currentNode.y) / 2;
    const path = `M ${currentNode.x} ${currentNode.y + nodeHeight / 2}
                  C ${currentNode.x} ${currentNode.y + nodeHeight / 2 + controlPointOffset},
                    ${forkNode.x} ${forkNode.y - nodeHeight / 2 - controlPointOffset},
                    ${forkNode.x} ${forkNode.y - nodeHeight / 2}`;
    edges.push({ from: currentNode, to: forkNode, path });
  });

  const totalHeight = forksY + nodeHeight + 40;

  return (
    <div className={styles.container} ref={containerRef}>
      <svg
        width={dimensions.width}
        height={totalHeight}
        viewBox={`0 0 ${dimensions.width} ${totalHeight}`}
        className={styles.svg}
        role="img"
        aria-label="Fork lineage graph"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill="var(--color-text-tertiary)" />
          </marker>
        </defs>

        {/* Edges */}
        <g className={styles.edges}>
          {edges.map((edge, index) => (
            <path
              key={index}
              d={edge.path}
              stroke="var(--color-border-hover)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
            />
          ))}
        </g>

        {/* Nodes */}
        <g className={styles.nodes}>
          {nodes.map((node) => {
            const nodeX = node.x - nodeWidth / 2;
            const nodeY = node.y - nodeHeight / 2;

            const fillColor =
              node.type === 'current'
                ? 'var(--color-primary-lighter)'
                : node.type === 'ancestor'
                  ? 'var(--color-accent-lighter)'
                  : 'var(--color-surface)';

            const strokeColor =
              node.type === 'current'
                ? 'var(--color-primary)'
                : node.type === 'ancestor'
                  ? 'var(--color-accent)'
                  : 'var(--color-border)';

            const textColor =
              node.type === 'current'
                ? 'var(--color-primary)'
                : node.type === 'ancestor'
                  ? 'var(--color-accent)'
                  : 'var(--color-text-primary)';

            return (
              <g key={node.id} className={styles.node}>
                <rect
                  x={nodeX}
                  y={nodeY}
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="8"
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth="2"
                />
                <text
                  x={node.x}
                  y={node.y - 8}
                  textAnchor="middle"
                  className={styles.nodeTitle}
                  fill={textColor}
                >
                  {node.title}
                </text>
                <text
                  x={node.x}
                  y={node.y + 10}
                  textAnchor="middle"
                  className={styles.nodeUser}
                  fill="var(--color-text-secondary)"
                >
                  {node.user}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
