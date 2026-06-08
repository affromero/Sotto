import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryGraph } from '@/components/memory/MemoryGraph';
import type { MemoryGraphData } from '@/components/memory/MemoryGraph';

// ---------------------------------------------------------------------------
// Mock cytoscape + cytoscape-fcose so jsdom doesn't need a real <canvas>.
// vi.hoisted() is required because vi.mock factories are hoisted to the top of
// the file — variables declared with const/let are NOT yet initialised at that
// point.  vi.hoisted() runs before the hoist boundary, so the references are
// safe to use inside the factory callbacks.
// ---------------------------------------------------------------------------

const { cytoscapeMock } = vi.hoisted(() => {
  const mockCy = {
    on: vi.fn().mockReturnThis(),
    layout: vi.fn().mockReturnValue({ run: vi.fn() }),
    destroy: vi.fn(),
    nodes: vi.fn().mockReturnValue([]),
    add: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    fit: vi.fn().mockReturnThis(),
  };
  const cytoscapeMock = vi.fn(() => mockCy);
  // Attach the `use` static method that MemoryGraph calls at module scope.
  (cytoscapeMock as unknown as { use: ReturnType<typeof vi.fn> }).use = vi.fn();
  return { cytoscapeMock };
});

vi.mock('cytoscape', () => ({
  default: cytoscapeMock,
}));

vi.mock('cytoscape-fcose', () => ({
  default: vi.fn(),
}));

// Mock MemoryNodeDetail so we don't need next/navigation in tests
vi.mock('@/components/memory/MemoryNodeDetail', () => ({
  MemoryNodeDetail: ({ node, onClose }: { node: { label: string }; onClose: () => void }) => (
    <div data-testid="node-detail">
      <span>{node.label}</span>
      <button onClick={onClose} type="button">Close</button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyGraph: MemoryGraphData = { nodes: [], edges: [] };

const smallGraph: MemoryGraphData = {
  nodes: [
    { id: 'n1', kind: 'vocab', label: 'Hund', translation: 'dog', strength: 0.8, due: false },
    { id: 'n2', kind: 'grammar', label: 'Nominativ', strength: 0.4, due: true },
  ],
  edges: [
    { source: 'n1', target: 'n2', type: 'related', weight: 0.5 },
  ],
};

// Build a graph that exceeds the MAX_NODES cap (400)
function buildLargeGraph(count: number): MemoryGraphData {
  return {
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `node-${i}`,
      kind: i % 2 === 0 ? 'vocab' : ('grammar' as 'vocab' | 'grammar'),
      label: `Word ${i}`,
      strength: Math.random(),
      due: i < 5,
    })),
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement window.matchMedia — stub it for the useEffect guard.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the empty-state placeholder when nodes is empty, without calling cytoscape()', () => {
    render(<MemoryGraph graph={emptyGraph} />);

    expect(
      screen.getByText(/your memory graph is empty/i),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/complete a class to start building it/i),
    ).toBeInTheDocument();

    // cytoscape() must NOT be called for an empty graph
    expect(cytoscapeMock).not.toHaveBeenCalled();
  });

  it('renders the canvas container and calls cytoscape() once for a non-empty graph', () => {
    render(<MemoryGraph graph={smallGraph} />);

    // The canvas div should be present (role="img")
    expect(screen.getByRole('img', { name: /memory graph/i })).toBeInTheDocument();

    // cytoscape() called exactly once
    expect(cytoscapeMock).toHaveBeenCalledTimes(1);
  });

  it('does not show the truncation note when nodes are within the cap', () => {
    render(<MemoryGraph graph={smallGraph} />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows the truncation note and hidden-count when nodes exceed the cap', () => {
    const total = 450;
    const largeGraph = buildLargeGraph(total);
    render(<MemoryGraph graph={largeGraph} />);

    const note = screen.getByRole('note');
    expect(note).toBeInTheDocument();
    // Should mention the hidden count (450 - 400 = 50)
    expect(note.textContent).toMatch(/50 more/i);
  });

  it('does not render MemoryNodeDetail when no node is selected', () => {
    render(<MemoryGraph graph={smallGraph} />);
    expect(screen.queryByTestId('node-detail')).not.toBeInTheDocument();
  });
});
