import {
  materialFocusChunkResultSchema,
  materialFocusMergedResultSchema,
  MATERIAL_FOCUS_ANALYSIS_LIMITS,
  type LearningCatalog,
  type LearningObjective,
  type MaterialFocusCitation,
  type MaterialSourceFocusCandidate,
  type MaterialFocusChunkResult,
  type MaterialFocusChunkReceipt,
} from '@sotto/shared';
import {
  materialFocusAnalysisHash,
  materialFocusAnalysisCoverage,
  restoreMaterialFocusAnalysis,
  type PreparedMaterialFocusAnalysis,
} from './protocol';

const order = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const distinct = (values: readonly string[]) => [...new Set(values)].sort(order);

/** Exact alias lookup retrieves candidates. It never certifies full criterion support. */
export function materialFocusCatalogCandidates(
  catalog: LearningCatalog | null,
  focus: MaterialSourceFocusCandidate
) {
  if (!catalog)
    return {
      status: 'CATALOG_UNAVAILABLE' as const,
      candidates: [],
      groupIds: [],
      unresolvedGrammarKeys: distinct(focus.grammarKeys),
      privateExtension: true,
    };
  const nodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  const objectives = catalog.nodes.filter(
    (node): node is LearningObjective => node.kind === 'OBJECTIVE'
  );
  const matches = new Map<
    string,
    {
      objectiveId: string;
      criterionVersion: number;
      level: LearningObjective['level'];
      relation: 'SOURCE_EXPOSURE_CANDIDATE';
      bases: string[];
    }
  >();
  const groups = new Set<string>();
  const unresolvedGrammarKeys: string[] = [];
  const add = (node: LearningObjective, basis: string) => {
    const previous = matches.get(node.id);
    if (previous) previous.bases = distinct([...previous.bases, basis]);
    else
      matches.set(node.id, {
        objectiveId: node.id,
        criterionVersion: node.criterionVersion,
        level: node.level,
        relation: 'SOURCE_EXPOSURE_CANDIDATE',
        bases: [basis],
      });
    let parent = node.parentId;
    while (parent !== null) {
      const group = nodes.get(parent);
      if (!group || group.kind !== 'GROUP') throw new Error('The pinned catalog ancestry changed.');
      groups.add(parent);
      parent = group.parentId;
    }
  };
  for (const id of distinct(focus.objectiveIds)) {
    const node = nodes.get(id);
    if (!node || node.kind !== 'OBJECTIVE')
      throw new Error('A focus objective is absent from the pinned catalog.');
    add(node, 'MODEL_PROPOSED_ID');
  }
  for (const key of distinct(focus.grammarKeys)) {
    const matching = objectives.filter((node) => node.grammarKeys.includes(key));
    if (matching.length !== 1) {
      unresolvedGrammarKeys.push(key);
      continue;
    }
    add(matching[0]!, `EXACT_GRAMMAR_ALIAS:${key}`);
  }
  for (const id of focus.groupIds) {
    if (nodes.get(id)?.kind !== 'GROUP')
      throw new Error('A focus group tag is absent from the pinned catalog.');
    groups.add(id);
  }
  return {
    status: matches.size
      ? unresolvedGrammarKeys.length
        ? ('PARTIAL_CANDIDATES' as const)
        : ('CANDIDATES' as const)
      : ('UNRESOLVED' as const),
    candidates: [...matches.values()].sort((left, right) =>
      order(left.objectiveId, right.objectiveId)
    ),
    groupIds: [...groups].sort(order),
    unresolvedGrammarKeys,
    privateExtension: !matches.size || unresolvedGrammarKeys.length > 0,
  };
}

function overlaps(left: MaterialFocusCitation, right: MaterialFocusCitation) {
  return (
    left.unitId === right.unitId &&
    left.streamId === right.streamId &&
    left.chunkSha256 === right.chunkSha256 &&
    left.codePointStart < right.codePointEnd &&
    right.codePointStart < left.codePointEnd
  );
}

/** Database display columns cannot retain control characters. Exact headings remain in the byte receipt. */
function materialFocusDisplayTitle(text: string) {
  let title = '';
  for (const point of text) {
    const clean = point.codePointAt(0)! < 32 || point === '\u007f' ? ' ' : point;
    if (title.length + clean.length > 240) break;
    title += clean;
  }
  title = title.trim();
  if (!title) throw new Error('A source focus requires a readable display title.');
  return title;
}

/** Merge only already source-validated, owned immutable unit results. No storage/provider calls. */
export function mergeMaterialSourceFocuses(options: {
  analysis: PreparedMaterialFocusAnalysis;
  catalog: LearningCatalog | null;
  results: readonly MaterialFocusChunkResult[];
  receipts?: readonly MaterialFocusChunkReceipt[];
}) {
  const analysis = restoreMaterialFocusAnalysis(options.analysis.identity, options.catalog);
  const units = new Map(analysis.units.map((unit, index) => [unit.id, { unit, index }]));
  const results = new Map<string, MaterialFocusChunkResult>();
  let aggregateBytes = 0,
    aggregateFocuses = 0;
  for (const input of options.results) {
    const result = materialFocusChunkResultSchema.parse(input),
      expected = units.get(result.unitId)?.unit;
    if (
      !expected ||
      result.analysisIdentityDigest !== analysis.identityDigest ||
      result.inputDigest !== expected.inputDigest ||
      result.coverage.chunkSha256 !== expected.source.chunkSha256 ||
      result.coverage.codePointStart !== expected.source.codePointStart ||
      result.coverage.codePointEnd !== expected.source.codePointEnd
    )
      throw new Error('A source focus result does not cover its admitted primary chunk.');
    const previous = results.get(result.unitId);
    if (previous && materialFocusAnalysisHash(previous) !== materialFocusAnalysisHash(result))
      throw new Error('Conflicting results cannot replace one immutable chunk analysis.');
    if (!previous) {
      aggregateBytes += Buffer.byteLength(JSON.stringify(result), 'utf8');
      aggregateFocuses += result.focuses.length;
      if (
        aggregateBytes > MATERIAL_FOCUS_ANALYSIS_LIMITS.aggregateBytes ||
        aggregateFocuses > MATERIAL_FOCUS_ANALYSIS_LIMITS.aggregateFocuses
      )
        throw new Error('The complete source analysis exceeds the explicit aggregate budget.');
    }
    results.set(result.unitId, result);
  }
  const orderedResults = [...results.values()].sort(
    (left, right) => units.get(left.unitId)!.index - units.get(right.unitId)!.index
  );
  const fragments = orderedResults.flatMap((result) =>
    [...result.focuses]
      .sort(
        (left, right) =>
          Math.min(
            ...left.citations
              .filter((citation) => citation.unitId === result.unitId)
              .map((citation) => citation.codePointStart)
          ) -
            Math.min(
              ...right.citations
                .filter((citation) => citation.unitId === result.unitId)
                .map((citation) => citation.codePointStart)
            ) || order(left.localId, right.localId)
      )
      .map((candidate) => ({
        id: materialFocusAnalysisHash({
          analysis: analysis.identityDigest,
          unitId: result.unitId,
          localId: candidate.localId,
        }),
        unitId: result.unitId,
        source: units.get(result.unitId)!.unit.source,
        uncertain: units.get(result.unitId)!.unit.uncertain,
        candidate,
        mapping: materialFocusCatalogCandidates(analysis.catalog, candidate),
      }))
  );
  const parent = new Map(fragments.map((fragment) => [fragment.id, fragment.id]));
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  const boundaries: Array<{
    fragmentId: string;
    reason: 'MISSING_SOURCE_ANCHOR' | 'AMBIGUOUS_SOURCE_ANCHOR' | 'CONFLICTING_SOURCE_HEADING';
  }> = [];
  for (const fragment of fragments) {
    const continuation = fragment.candidate.continuation;
    if (!continuation) continue;
    const unit = units.get(fragment.unitId)!.unit;
    if (continuation.unitId !== unit.previousId)
      throw new Error('Continuation cannot merge nonadjacent source chunks.');
    const candidates = fragments.filter(
      (previous) =>
        previous.unitId === unit.previousId &&
        previous.source.sourceId === fragment.source.sourceId &&
        previous.source.origin === fragment.source.origin &&
        previous.candidate.citations.some((citation) => overlaps(citation, continuation))
    );
    if (candidates.length !== 1) {
      boundaries.push({
        fragmentId: fragment.id,
        reason: candidates.length ? 'AMBIGUOUS_SOURCE_ANCHOR' : 'MISSING_SOURCE_ANCHOR',
      });
      continue;
    }
    const previous = candidates[0]!;
    if (
      fragment.candidate.heading &&
      previous.candidate.heading &&
      materialFocusAnalysisHash(fragment.candidate.heading) !==
        materialFocusAnalysisHash(previous.candidate.heading)
    ) {
      boundaries.push({
        fragmentId: fragment.id,
        reason: 'CONFLICTING_SOURCE_HEADING',
      });
      continue;
    }
    parent.set(fragment.id, root(previous.id));
  }
  const groups = new Map<string, typeof fragments>();
  for (const fragment of fragments) {
    const id = root(fragment.id),
      values = groups.get(id) ?? [];
    values.push(fragment);
    groups.set(id, values);
  }
  const focuses = [...groups].map(([rootId, parts], index) => {
    const citations = new Map<string, MaterialFocusCitation>();
    const headings = new Map<string, NonNullable<MaterialSourceFocusCandidate['heading']>>();
    const objectiveCandidates = new Map<
      string,
      (typeof parts)[number]['mapping']['candidates'][number]
    >();
    for (const part of parts) {
      for (const citation of part.candidate.citations)
        citations.set(materialFocusAnalysisHash(citation), citation);
      if (part.candidate.heading)
        headings.set(materialFocusAnalysisHash(part.candidate.heading), part.candidate.heading);
      for (const candidate of part.mapping.candidates) {
        const key = `${candidate.objectiveId}:${candidate.criterionVersion}`,
          existing = objectiveCandidates.get(key);
        objectiveCandidates.set(
          key,
          existing
            ? {
                ...existing,
                bases: distinct([...existing.bases, ...candidate.bases]),
              }
            : candidate
        );
      }
    }
    return {
      id: materialFocusAnalysisHash({
        analysis: analysis.identityDigest,
        firstFragment: rootId,
      }),
      order: index,
      title: materialFocusDisplayTitle(
        parts[0]!.candidate.heading?.title ?? parts[0]!.candidate.title
      ),
      sourceHeadings: [...headings.values()],
      kind: parts.length > 1 ? ('COMBINED' as const) : parts[0]!.candidate.kind,
      fragments: parts,
      citations: [...citations.values()].sort(
        (left, right) =>
          units.get(left.unitId)!.index - units.get(right.unitId)!.index ||
          left.codePointStart - right.codePointStart ||
          left.codePointEnd - right.codePointEnd
      ),
      objectiveCandidates: [...objectiveCandidates.values()].sort((left, right) =>
        order(left.objectiveId, right.objectiveId)
      ),
      groupIds: distinct(parts.flatMap((part) => part.mapping.groupIds)),
      unresolvedGrammarKeys: distinct(parts.flatMap((part) => part.mapping.unresolvedGrammarKeys)),
      privateExtension: parts.some((part) => part.mapping.privateExtension),
      uncertainSource: parts.some((part) => part.uncertain),
      exposureOnly: true as const,
    };
  });
  const headingValues = new Map<
    string,
    {
      heading: NonNullable<MaterialSourceFocusCandidate['heading']>;
      firstUnitId: string;
    }
  >();
  for (const result of orderedResults)
    for (const heading of result.headings)
      if (!headingValues.has(materialFocusAnalysisHash(heading)))
        headingValues.set(materialFocusAnalysisHash(heading), {
          heading,
          firstUnitId: result.unitId,
        });
  const headings = [...headingValues.values()].sort(
    (left, right) =>
      units.get(left.firstUnitId)!.index - units.get(right.firstUnitId)!.index ||
      left.heading.citations[0]!.codePointStart - right.heading.citations[0]!.codePointStart
  );
  const mentions = new Map<
    string,
    {
      objectiveId: string;
      criterionVersion: number;
      focusIds: string[];
      relation: 'SOURCE_EXPOSURE_CANDIDATE';
    }
  >();
  for (const focus of focuses)
    for (const part of focus.fragments)
      for (const candidate of part.mapping.candidates) {
        const key = `${candidate.objectiveId}:${candidate.criterionVersion}`;
        const mention = mentions.get(key) ?? {
          objectiveId: candidate.objectiveId,
          criterionVersion: candidate.criterionVersion,
          focusIds: [],
          relation: 'SOURCE_EXPOSURE_CANDIDATE' as const,
        };
        if (!mention.focusIds.includes(focus.id)) mention.focusIds.push(focus.id);
        mentions.set(key, mention);
      }
  const concepts = [...mentions.values()].sort((left, right) =>
    order(left.objectiveId, right.objectiveId)
  );
  const receiptInputs = options.receipts ?? [];
  if (
    focuses.some(
      (focus) =>
        Buffer.byteLength(JSON.stringify(focus), 'utf8') > MATERIAL_FOCUS_ANALYSIS_LIMITS.focusBytes
    )
  )
    throw new Error('One complete source focus exceeds the explicit frozen detail budget.');
  if (
    receiptInputs.some((receipt) => receipt.status === 'ANALYZED' && !results.has(receipt.unitId))
  )
    throw new Error('Full analyzed coverage requires its validated chunk result.');
  const receipts = [
    ...receiptInputs.filter((receipt) => !results.has(receipt.unitId)),
    ...orderedResults.map((result): MaterialFocusChunkReceipt => ({
      unitId: result.unitId,
      inputDigest: result.inputDigest,
      status: 'ANALYZED',
      resultSha256: materialFocusAnalysisHash(result),
      diagnostic: null,
    })),
  ];
  const coverage = materialFocusAnalysisCoverage(analysis, receipts);
  const merged = {
    schemaVersion: 1 as const,
    analysisIdentityDigest: analysis.identityDigest,
    focuses,
    headings,
    concepts,
    unresolvedBoundaries: boundaries,
    coverage,
    exposureOnly: true as const,
  };
  if (
    Buffer.byteLength(JSON.stringify(merged), 'utf8') >
    MATERIAL_FOCUS_ANALYSIS_LIMITS.aggregateBytes
  )
    throw new Error('The complete merged source analysis exceeds the explicit aggregate budget.');
  return materialFocusMergedResultSchema.parse({
    ...merged,
    resultDigest: materialFocusAnalysisHash({
      ...merged,
      chunkResults: orderedResults.map((result) => ({
        unitId: result.unitId,
        sha256: materialFocusAnalysisHash(result),
      })),
    }),
  });
}
