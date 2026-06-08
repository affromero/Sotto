/**
 * components/learn/MemoryGraphWebView.tsx
 *
 * Renders the vocabulary + grammar memory graph inside a react-native-webview.
 * Loads cytoscape + cytoscape-fcose from unpkg CDN, injects the graph JSON.
 * Vocab nodes = amber (#D97706), grammar nodes = navy (#1E3A5F).
 * Node size scales with `strength`; `due` nodes get a bright highlight ring.
 */

import { StyleSheet, View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, spacing, typography } from '@sotto/shared';
import type { MemoryGraphData } from '../../lib/learn-api';

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildHtml(graph: MemoryGraphData): string {
  const nodesJson = JSON.stringify(
    graph.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.label,
        translation: n.translation ?? '',
        kind: n.kind,
        strength: n.strength,
        due: n.due,
      },
    })),
  );

  const edgesJson = JSON.stringify(
    graph.edges.map((e) => ({
      data: {
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight,
      },
    })),
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #FEFCF8; font-family: -apple-system, sans-serif; }
  #cy { width: 100vw; height: 100vh; }
</style>
</head>
<body>
<div id="cy"></div>
<script src="https://unpkg.com/cytoscape@3.29.2/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js"></script>
<script>
(function () {
  cytoscape.use(cytoscapeFcose);

  var nodes = ${nodesJson};
  var edges = ${edgesJson};

  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes: nodes, edges: edges },
    style: [
      {
        selector: 'node',
        style: {
          'background-color': function(ele) {
            return ele.data('kind') === 'vocab' ? '#D97706' : '#1E3A5F';
          },
          'width': function(ele) {
            return 20 + ele.data('strength') * 20;
          },
          'height': function(ele) {
            return 20 + ele.data('strength') * 20;
          },
          'label': 'data(label)',
          'color': '#1A1A1A',
          'font-size': '11px',
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'border-width': function(ele) {
            return ele.data('due') ? 3 : 0;
          },
          'border-color': '#F59E0B',
        }
      },
      {
        selector: 'edge',
        style: {
          'width': function(ele) { return 1 + ele.data('weight') * 2; },
          'line-color': '#E5E1D8',
          'curve-style': 'bezier',
          'opacity': 0.6,
        }
      }
    ],
    layout: {
      name: 'fcose',
      animate: false,
      quality: 'default',
      randomize: true,
    },
    userZoomingEnabled: true,
    userPanningEnabled: true,
    minZoom: 0.3,
    maxZoom: 3,
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MemoryGraphWebViewProps {
  graph: MemoryGraphData;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MemoryGraphWebView({ graph }: MemoryGraphWebViewProps) {
  if (graph.nodes.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No words yet</Text>
        <Text style={styles.emptySubtitle}>
          Complete a class to start building your memory graph.
        </Text>
      </View>
    );
  }

  const html = buildHtml(graph);

  return (
    <WebView
      source={{ html }}
      style={styles.webview}
      scrollEnabled={false}
      bounces={false}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled={false}
      accessibilityLabel="Memory graph"
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: typography.fontHeading,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: typography.fontBody,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
