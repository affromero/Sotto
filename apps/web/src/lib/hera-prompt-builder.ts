/**
 * Converts structured segment metadata into effective Hera motion graphic prompts
 * with Sotto brand tokens baked in.
 */

const BRAND = {
  primary: '#3F4FB0', // Aula Indigo
  accent: '#2A3550',  // Aula Slate
  bg: '#F5F4F0',      // Soft Paper
  headingFont: 'Newsreader',
  bodyFont: 'IBM Plex Sans',
};

const BRAND_STYLE = `Color palette: ${BRAND.primary} (indigo primary), ${BRAND.accent} (slate accent), ${BRAND.bg} (soft paper background). Typography: ${BRAND.headingFont} for headings, ${BRAND.bodyFont} for body text. Style: clean, scholarly, editorial.`;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function buildDataChartPrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const chartType = (metadata.chartType as string) ?? 'bar';
  const title = (metadata.title as string) ?? '';
  const dataPoints = metadata.dataPoints as Array<{ label: string; value: number }> | undefined;

  let dataDesc = '';
  if (dataPoints && dataPoints.length > 0) {
    dataDesc = ` Data: ${dataPoints.map(d => `${d.label}: ${d.value}`).join(', ')}.`;
  }

  return `Animated ${chartType} chart motion graphic.${title ? ` Title: "${title}".` : ''}${dataDesc} Bars/lines should rise and fill with smooth easing animation. ${BRAND_STYLE} Context: ${truncate(segmentText, 200)}`;
}

function buildQuotePrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const quote = (metadata.quote as string) ?? (metadata.text as string) ?? '';
  const attribution = (metadata.attribution as string) ?? (metadata.speaker as string) ?? '';

  return `Animated typography quote card. Quote: "${truncate(quote, 300)}"${attribution ? ` — ${attribution}` : ''}. Text should elegantly fade in with a subtle scale entrance, quotation marks animate first. ${BRAND_STYLE} Context: ${truncate(segmentText, 150)}`;
}

function buildComparisonPrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const items = metadata.items as Array<{ label: string; value?: string }> | undefined;
  const title = (metadata.title as string) ?? '';

  let itemsDesc = '';
  if (items && items.length > 0) {
    itemsDesc = ` Comparing: ${items.map(i => i.label).join(' vs ')}.`;
  }

  return `Animated side-by-side comparison infographic.${title ? ` "${title}".` : ''}${itemsDesc} Elements slide in from opposite sides and settle into position. ${BRAND_STYLE} Context: ${truncate(segmentText, 200)}`;
}

function buildTimelinePrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const events = metadata.events as Array<{ year?: string; label: string }> | undefined;
  const title = (metadata.title as string) ?? '';

  let eventsDesc = '';
  if (events && events.length > 0) {
    eventsDesc = ` Events: ${events.map(e => `${e.year ?? '•'} ${e.label}`).join('; ')}.`;
  }

  return `Animated horizontal timeline motion graphic.${title ? ` "${title}".` : ''}${eventsDesc} Timeline draws left to right, events appear sequentially with staggered fade-in. ${BRAND_STYLE} Context: ${truncate(segmentText, 200)}`;
}

function buildDiagramPrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const diagramType = (metadata.diagramType as string) ?? 'flow';
  const title = (metadata.title as string) ?? '';
  const nodes = metadata.nodes as Array<{ label: string }> | undefined;

  let nodesDesc = '';
  if (nodes && nodes.length > 0) {
    nodesDesc = ` Nodes: ${nodes.map(n => n.label).join(' → ')}.`;
  }

  return `Animated ${diagramType} diagram.${title ? ` "${title}".` : ''}${nodesDesc} Nodes and connections draw in sequentially with smooth reveal animation. ${BRAND_STYLE} Context: ${truncate(segmentText, 200)}`;
}

function buildTextCardPrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const headline = (metadata.headline as string) ?? '';
  const body = (metadata.body as string) ?? '';

  return `Animated text card motion graphic.${headline ? ` Headline: "${headline}".` : ''}${body ? ` Body: "${truncate(body, 200)}".` : ''} Text fades in with subtle upward drift, headline first then body. ${BRAND_STYLE} Context: ${truncate(segmentText, 200)}`;
}

function buildDataTablePrompt(metadata: Record<string, unknown>, segmentText: string): string {
  const headers = metadata.headers as { title?: string; subtitle?: string } | undefined;
  const columns = (metadata.columns as Array<{ label: string }>) ?? [];
  const rows = (metadata.rows as Array<{ values: Record<string, string | number> }>) ?? [];

  const title = headers?.title ?? '';
  const colLabels = columns.map((c) => c.label).join(' | ');
  const rowCount = rows.length;

  return `Animated data table motion graphic${title ? `: "${title}"` : ''}. Columns: ${colLabels}. ${rowCount} rows of data revealed row-by-row with staggered fade-in. ${BRAND_STYLE} Context: ${truncate(segmentText, 300)}`;
}

export function buildHeraPrompt(params: {
  visualType: string;
  metadata: Record<string, unknown> | null;
  segmentText: string;
}): string {
  const metadata = params.metadata ?? {};
  const segmentText = params.segmentText;

  switch (params.visualType) {
    case 'DATA_CHART':
      return buildDataChartPrompt(metadata, segmentText);
    case 'QUOTE':
      return buildQuotePrompt(metadata, segmentText);
    case 'COMPARISON':
      return buildComparisonPrompt(metadata, segmentText);
    case 'TIMELINE':
      return buildTimelinePrompt(metadata, segmentText);
    case 'DIAGRAM':
      return buildDiagramPrompt(metadata, segmentText);
    case 'TEXT_CARD':
      return buildTextCardPrompt(metadata, segmentText);
    case 'DATA_TABLE':
      return buildDataTablePrompt(metadata, segmentText);
    default:
      return `Animated motion graphic for podcast visual. ${BRAND_STYLE} Context: ${truncate(segmentText, 300)}`;
  }
}
