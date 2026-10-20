// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  materialFocusAnalysisIdentitySchema,
  materialFocusChunkResultSchema,
  type MaterialFocusSourceSnapshot,
  type MaterialFocusMaterialSnapshot,
  type MaterialFocusCitation,
  type MaterialFocusChunkResult,
  type MaterialSourceFocusCandidate,
} from '@sotto/shared';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { prepareMaterialPageText } from '@/lib/course-materials/extraction/chunks';
import {
  prepareMaterialFocusAnalysis,
  restoreMaterialFocusAnalysis,
  prepareMaterialFocusChunk,
  prepareMaterialFocusTextSnapshot,
  parseMaterialFocusChunk,
  materialFocusAnalysisCoverage,
  materialFocusAnalysisHash,
  type PreparedMaterialFocusAnalysis,
  type PreparedMaterialFocusChunk,
} from '@/lib/course-materials/analysis/protocol';
import {
  mergeMaterialSourceFocuses,
  materialFocusCatalogCandidates,
} from '@/lib/course-materials/analysis/merge';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const catalog = getLanguageCatalog('de');
const selection = {
  provider: 'local',
  model: 'local:owned-analysis-fixture',
  endpoint: 'http://127.0.0.1:9999/v1',
  credentialFingerprint: null,
};

function paste(text: string, id = 'paste-owned', width = 16_000) {
  const prepared = prepareMaterialPageText(
    {
      text,
      pageNumber: 1,
      source: {
        origin: 'EMBEDDED_TEXT',
        method: 'OWNED_UTF8_SNAPSHOT',
        version: '1',
      },
    },
    { codePoints: width, utf8Bytes: width * 4 }
  );
  const chunks = [...prepared.chunks];
  const snapshot: MaterialFocusSourceSnapshot = {
    sourceKind: 'PASTE',
    sourceId: id,
    userId: 'owner',
    revision: 1,
    snapshotSha256: prepared.manifest.textSha256,
    name: 'Owned pasted source',
    note: null,
    stream: {
      streamId: `${id}:stream`,
      manifest: prepared.manifest,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.index,
        chunkSha256: chunk.sha256,
        codePointStart: chunk.codePointStart,
        codePointEnd: chunk.codePointEnd,
        utf8ByteStart: chunk.utf8ByteStart,
        utf8ByteEnd: chunk.utf8ByteEnd,
      })),
    },
  };
  return { snapshot, chunks };
}
function analysis(
  sources: readonly MaterialFocusSourceSnapshot[],
  targetCatalog = catalog,
  targetLang = 'de'
) {
  return prepareMaterialFocusAnalysis({
    owner: { userId: 'owner', generation: 100 },
    course: null,
    nativeLang: 'en',
    targetLang,
    catalog: targetCatalog,
    selection,
    sources,
    analyzerVersion: 'owned-analyzer-1',
    runtimeRevision: 'owned-runtime-1',
  });
}
function window(
  input: PreparedMaterialFocusAnalysis,
  chunks: readonly { pageNumber: number; index: number; text: string }[],
  unitIndex = 0
) {
  const unit = input.units[unitIndex]!;
  const ids = [unit.previousId, unit.id, unit.nextId].filter((id): id is string => id !== null);
  return prepareMaterialFocusChunk({
    analysis: input,
    unitId: unit.id,
    chunks: ids.map((id) => {
      const source = input.units.find((item) => item.id === id)!.source;
      const chunk = chunks.find(
        (item) => item.pageNumber === source.pageNumber && item.index === source.chunkIndex
      );
      if (!chunk) throw new Error('Fixture source chunk missing');
      return { unitId: id, text: chunk.text };
    }),
  });
}
function quote(
  prepared: PreparedMaterialFocusChunk,
  start = 0,
  end?: number,
  unitId = prepared.unit.id
): MaterialFocusCitation {
  const entry = prepared.window.find((item) => item.unit.id === unitId)!;
  const points = [...entry.text],
    stop = end ?? Math.min(points.length, start + 40);
  const source = entry.unit.source,
    selected = points.slice(start, stop).join('');
  const byteStart =
    source.utf8ByteStart + Buffer.byteLength(points.slice(0, start).join(''), 'utf8');
  return {
    unitId,
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sourceSha256: source.sourceSha256,
    materialId: source.materialId,
    runId: source.runId,
    streamId: source.streamId,
    pageNumber: source.pageNumber,
    origin: source.origin,
    chunkIndex: source.chunkIndex,
    chunkSha256: source.chunkSha256,
    pageTextSha256: source.pageTextSha256,
    codePointStart: source.codePointStart + start,
    codePointEnd: source.codePointStart + stop,
    utf8ByteStart: byteStart,
    utf8ByteEnd: byteStart + Buffer.byteLength(selected, 'utf8'),
    quote: selected,
  };
}
function focus(
  prepared: PreparedMaterialFocusChunk,
  overrides: Partial<MaterialSourceFocusCandidate> = {}
): MaterialSourceFocusCandidate {
  return {
    localId: 'owned-focus',
    kind: 'GRAMMAR',
    title: 'A precise source focus',
    description: 'A source-supported construction and its function.',
    communicativeIntent: null,
    heading: null,
    grammarKeys: [],
    objectiveIds: [],
    groupIds: [],
    citations: [quote(prepared)],
    continuation: null,
    ...overrides,
  };
}
function result(
  prepared: PreparedMaterialFocusChunk,
  focuses: MaterialSourceFocusCandidate[] = []
): MaterialFocusChunkResult {
  return {
    schemaVersion: 1,
    analysisIdentityDigest: prepared.analysis.identityDigest,
    unitId: prepared.unit.id,
    inputDigest: prepared.inputDigest,
    coverage: {
      chunkSha256: prepared.unit.source.chunkSha256,
      codePointStart: prepared.unit.source.codePointStart,
      codePointEnd: prepared.unit.source.codePointEnd,
    },
    headings: [],
    focuses,
  };
}
const parse = (prepared: PreparedMaterialFocusChunk, output: MaterialFocusChunkResult) =>
  parseMaterialFocusChunk(prepared, JSON.stringify(output), {
    completion: 'COMPLETE',
  });
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reorder(child)])
  );
}

describe('complete private source analysis inputs', () => {
  it('preserves a 65-page source over one million code points and discovers the final page focus', () => {
    const material: MaterialFocusMaterialSnapshot = {
      sourceKind: 'MATERIAL',
      materialId: 'material',
      userId: 'owner',
      materialGeneration: 200,
      runId: 'run',
      processingRevision: 2,
      originalSha256: 'a'.repeat(64),
      name: 'Owned 65-page fixture.pdf',
      extractorVersion: 'extractor-v1',
      rendererVersion: 'renderer-v1',
      pageCount: 65,
      pages: [],
    };
    const texts = new Map<string, string>();
    for (let pageNumber = 1; pageNumber <= 65; pageNumber++) {
      const text =
        `Page ${pageNumber}: ` +
        '😀漢字a'.repeat(4200) +
        (pageNumber === 65 ? ' Final source class: obwohl und Reflexivpronomen.' : '');
      const page = prepareMaterialPageText({
        text,
        pageNumber,
        source: {
          origin: 'EMBEDDED_TEXT',
          method: 'OWNED_FIXTURE',
          version: '1',
        },
      });
      const chunks = [...page.chunks],
        streamId = `page-${pageNumber}`;
      for (const chunk of chunks) texts.set(`${streamId}:${chunk.index}`, chunk.text);
      material.pages.push({
        pageNumber,
        embeddedText: { state: 'EXTRACTED' },
        visual: {
          state: 'UNAVAILABLE',
          diagnostic: 'Handwriting remains unrecognized.',
        },
        streams: [
          {
            streamId,
            manifest: page.manifest,
            chunks: chunks.map((chunk) => ({
              chunkIndex: chunk.index,
              chunkSha256: chunk.sha256,
              codePointStart: chunk.codePointStart,
              codePointEnd: chunk.codePointEnd,
              utf8ByteStart: chunk.utf8ByteStart,
              utf8ByteEnd: chunk.utf8ByteEnd,
            })),
          },
        ],
      });
    }
    const input = analysis([material]);
    expect(
      input.units.reduce(
        (sum, unit) => sum + unit.source.codePointEnd - unit.source.codePointStart,
        0
      )
    ).toBeGreaterThan(1_000_000);
    const outputs = input.units.map((unit) => {
      const ids = [unit.previousId, unit.id, unit.nextId].filter((id): id is string => id !== null);
      const prepared = prepareMaterialFocusChunk({
        analysis: input,
        unitId: unit.id,
        chunks: ids.map((id) => {
          const item = input.units.find((candidate) => candidate.id === id)!;
          return {
            unitId: id,
            text: texts.get(`${item.source.streamId}:${item.source.chunkIndex}`)!,
          };
        }),
      });
      if (unit.id !== input.units.at(-1)!.id) return parse(prepared, result(prepared));
      const text = prepared.window.find((item) => item.unit.id === unit.id)!.text;
      const start =
        [...text].length - [...' Final source class: obwohl und Reflexivpronomen.'].length;
      return parse(
        prepared,
        result(prepared, [
          focus(prepared, {
            title: 'Concession and reflexive pronouns',
            kind: 'COMBINED',
            grammarKeys: ['obwohl-trotzdem', 'reflexive-pronouns'],
            citations: [quote(prepared, start, [...text].length)],
          }),
        ])
      );
    });
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: outputs,
    });
    expect(merged.focuses).toHaveLength(1);
    expect(merged.focuses[0]!.citations[0]!.pageNumber).toBe(65);
    expect(merged.concepts.map((item) => item.objectiveId)).toEqual([
      'de.g.obwohl-trotzdem',
      'de.g.reflexive-accusative',
    ]);
    expect(merged.coverage).toMatchObject({
      readableTextComplete: true,
      originalContentComplete: false,
      status: 'PARTIAL',
    });
    expect(merged.coverage.unresolvedPages).toHaveLength(65);
    const partial = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: outputs.slice(0, -1),
    });
    expect(partial.coverage.readableTextComplete).toBe(false);
    expect(partial.coverage.pendingUnitIds).toEqual([input.units.at(-1)!.id]);
  });

  it('retains embedded and uncertain recognized text as distinct units', () => {
    const embedded = prepareMaterialPageText({
      text: 'Printed source',
      pageNumber: 1,
      source: { origin: 'EMBEDDED_TEXT', method: 'FIXTURE', version: '1' },
    });
    const visual = prepareMaterialPageText({
      text: 'Uncertain handwritten annotation',
      pageNumber: 1,
      source: { origin: 'VISUAL_RECOGNITION', method: 'FIXTURE', version: '1' },
    });
    const make = (prepared: typeof embedded, streamId: string) => ({
      streamId,
      manifest: prepared.manifest,
      chunks: [...prepared.chunks].map((chunk) => ({
        chunkIndex: chunk.index,
        chunkSha256: chunk.sha256,
        codePointStart: chunk.codePointStart,
        codePointEnd: chunk.codePointEnd,
        utf8ByteStart: chunk.utf8ByteStart,
        utf8ByteEnd: chunk.utf8ByteEnd,
      })),
    });
    const input = analysis([
      {
        sourceKind: 'MATERIAL',
        materialId: 'mixed',
        userId: 'owner',
        materialGeneration: 1,
        runId: 'mixed-run',
        processingRevision: 1,
        originalSha256: 'a'.repeat(64),
        name: 'Mixed.pdf',
        extractorVersion: '1',
        rendererVersion: '1',
        pageCount: 1,
        pages: [
          {
            pageNumber: 1,
            embeddedText: { state: 'EXTRACTED' },
            visual: {
              state: 'UNCERTAIN',
              assessor: { method: 'FIXTURE', version: '1' },
              pageImageSha256: 'b'.repeat(64),
              extent: 'FULL_PAGE',
              diagnostic: 'One visible word remains illegible.',
            },
            streams: [make(visual, 'visual'), make(embedded, 'embedded')],
          },
        ],
      },
    ]);
    expect(input.units.map((unit) => [unit.source.origin, unit.uncertain])).toEqual([
      ['EMBEDDED_TEXT', false],
      ['VISUAL_RECOGNITION', true],
    ]);
    expect(input.units.every((unit) => unit.previousId === null && unit.nextId === null)).toBe(
      true
    );
  });

  it('pins paste and note snapshots without a material, image or original-storage receipt', () => {
    const text = '\uFEFFExact 😀\0é source';
    const prepared = prepareMaterialFocusTextSnapshot({
      sourceKind: 'COURSE_NOTE',
      sourceId: 'note-source',
      userId: 'owner',
      revision: 3,
      name: 'Owned note',
      text,
      note: { id: 'note', revision: 'updated-3' },
    });
    const input = analysis([prepared.snapshot]);
    expect(prepared.snapshot.snapshotSha256).toBe(sha(text));
    expect(prepared.chunks.map((chunk) => chunk.text).join('')).toBe(text);
    expect(input.units[0]!.source).toMatchObject({
      sourceKind: 'COURSE_NOTE',
      materialId: null,
      runId: null,
      processingRevision: null,
      origin: 'SOURCE_TEXT',
      sourceSha256: sha(text),
    });
    expect(() => analysis([{ ...prepared.snapshot, note: null }])).toThrow('snapshots');
  });

  it('requires every page, manifest chunk, source owner and exact processing revision', () => {
    const source = paste('A repeated source '.repeat(10), 'paste', 20).snapshot;
    expect(() =>
      analysis([
        {
          ...source,
          stream: { ...source.stream, chunks: source.stream.chunks.slice(1) },
        },
      ])
    ).toThrow();
    expect(() => analysis([{ ...source, userId: 'other-owner' }])).toThrow('private owner');
    const input = analysis([source]);
    const changed = structuredClone(input.identity);
    if (changed.sources[0]!.sourceKind !== 'PASTE') throw new Error('Expected paste fixture');
    changed.sources[0]!.revision++;
    expect(restoreMaterialFocusAnalysis(changed, catalog).identityDigest).not.toBe(
      input.identityDigest
    );
    expect(() =>
      materialFocusAnalysisIdentitySchema.parse({
        ...input.identity,
        mastery: true,
      })
    ).toThrow();
  });

  it('stabilizes identity and request bytes across source-set and JSONB property ordering', () => {
    const first = paste('First precise source', 'a'),
      second = paste('Second precise source', 'b');
    const input = analysis([first.snapshot, second.snapshot]);
    expect(analysis([second.snapshot, first.snapshot]).identityDigest).toBe(input.identityDigest);
    const prepared = window(input, first.chunks);
    const restored = restoreMaterialFocusAnalysis(
      reorder(input.identity) as typeof input.identity,
      catalog
    );
    expect(window(restored, first.chunks).messages).toEqual(prepared.messages);
    expect(window(restored, first.chunks).inputDigest).toBe(prepared.inputDigest);
    const differentOwner = {
      ...input.identity,
      owner: { userId: 'owner', generation: 101 },
    };
    expect(restoreMaterialFocusAnalysis(differentOwner, catalog).identityDigest).not.toBe(
      input.identityDigest
    );
  });

  it('admits ten retained documents plus owned paste and note while enforcing the independent file budget', () => {
    const owned = paste('Source class');
    const material = (index: number): MaterialFocusMaterialSnapshot => ({
      sourceKind: 'MATERIAL',
      materialId: `material-${index}`,
      userId: 'owner',
      materialGeneration: 1,
      runId: `run-${index}`,
      processingRevision: 1,
      originalSha256: 'a'.repeat(64),
      name: 'Document.pdf',
      extractorVersion: '1',
      rendererVersion: '1',
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          embeddedText: { state: 'EXTRACTED' },
          visual: { state: 'UNASSESSED' },
          streams: [owned.snapshot.stream],
        },
      ],
    });
    const note = prepareMaterialFocusTextSnapshot({
      sourceKind: 'COURSE_NOTE',
      sourceId: 'note',
      userId: 'owner',
      revision: 1,
      name: 'Course note',
      text: 'A private course note',
      note: { id: 'note', revision: '1' },
    }).snapshot;
    const documents = Array.from({ length: 10 }, (_, index) => material(index));
    expect(analysis([...documents, owned.snapshot, note]).identity.sources).toHaveLength(12);
    expect(() => analysis([...documents, material(10)])).toThrow('ten original');
  });
});

describe('bounded exact source analysis responses', () => {
  it('validates astral, RTL, BOM, NUL and decomposed Unicode with exact code-point and UTF-8 offsets', () => {
    const source = paste('\uFEFF😀 العربية é\0Passiv Präsens');
    const prepared = window(analysis([source.snapshot]), source.chunks);
    const citation = quote(prepared, 1, 15);
    const output = result(prepared, [focus(prepared, { citations: [citation] })]);
    expect(parse(prepared, output).focuses[0]!.citations[0]).toEqual(citation);
    for (const changed of [
      { ...citation, utf8ByteStart: citation.utf8ByteStart + 1 },
      { ...citation, quote: citation.quote.normalize('NFC') },
      { ...citation, sourceId: 'other' },
      { ...citation, codePointEnd: 999999 },
    ])
      expect(() =>
        parse(prepared, result(prepared, [focus(prepared, { citations: [changed] })]))
      ).toThrow();
  });

  it('reconstructs an original heading split across exact chunk boundaries', () => {
    const source = paste('Passiv Präsens\nExamples follow', 'heading', 8);
    const input = analysis([source.snapshot]),
      prepared = window(input, source.chunks, 1);
    const previous = quote(prepared, 0, 8, prepared.unit.previousId!);
    const current = quote(prepared, 0, 6);
    const output = result(prepared);
    output.headings = [{ title: previous.quote + current.quote, citations: [previous, current] }];
    expect(parse(prepared, output).headings[0]!.title).toBe('Passiv Präsens');
    const first = window(input, source.chunks, 0),
      firstOutput = result(first);
    firstOutput.headings = output.headings;
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: [parse(prepared, output), parse(first, firstOutput)],
    });
    expect(merged.headings[0]!.firstUnitId).toBe(first.unit.id);
    output.headings[0]!.title = 'Corrected heading';
    expect(() => parse(prepared, output)).toThrow('exact primary');
  });

  it('requires primary support and the complete primary coverage rather than context-only copying', () => {
    const source = paste('Previous class Current class Next class', 'context', 14);
    const prepared = window(analysis([source.snapshot]), source.chunks, 1);
    const old = quote(prepared, 0, 8, prepared.unit.previousId!);
    expect(() =>
      parse(prepared, result(prepared, [focus(prepared, { citations: [old] })]))
    ).toThrow('primary source');
    const output = result(prepared);
    output.coverage.codePointEnd--;
    expect(() => parse(prepared, output)).toThrow('complete exact');
    expect(() => parse(prepared, { ...result(prepared), unitId: 'f'.repeat(64) })).toThrow(
      'primary'
    );
  });

  it('rejects finish-length or unknown completion even when complete-looking JSON parses', () => {
    const source = paste('Source class');
    const prepared = window(analysis([source.snapshot]), source.chunks);
    for (const completion of ['TRUNCATED', 'UNKNOWN'] as const)
      expect(() =>
        parseMaterialFocusChunk(prepared, JSON.stringify(result(prepared)), {
          completion,
        })
      ).toThrow('cannot complete');
    expect(() => parseMaterialFocusChunk(prepared, '{', { completion: 'COMPLETE' })).toThrow();
    expect(() =>
      parseMaterialFocusChunk(prepared, 'x'.repeat(524289), {
        completion: 'COMPLETE',
      })
    ).toThrow('budget');
  });

  it('rejects invented catalog IDs, group tags and unsupported situation claims', () => {
    const source = paste('Source class');
    const prepared = window(analysis([source.snapshot]), source.chunks);
    for (const invalid of [
      { objectiveIds: ['fr.g.unknown'] },
      { groupIds: ['de.grammar.invented'] },
      { kind: 'SITUATION' as const, communicativeIntent: null },
    ])
      expect(() => parse(prepared, result(prepared, [focus(prepared, invalid)]))).toThrow();
    expect(() =>
      materialFocusChunkResultSchema.parse({
        ...result(prepared),
        earned: true,
      })
    ).toThrow();
  });

  it('keeps unknown language catalogs private and unresolved while still discovering source focuses', () => {
    const source = paste('A source focus in an unsupported catalog language');
    const input = prepareMaterialFocusAnalysis({
      owner: { userId: 'owner', generation: 100 },
      course: null,
      nativeLang: 'en',
      targetLang: 'sv',
      catalog: null,
      selection,
      sources: [source.snapshot],
      analyzerVersion: '1',
      runtimeRevision: '1',
    });
    const prepared = window(input, source.chunks),
      output = parse(
        prepared,
        result(prepared, [focus(prepared, { grammarKeys: ['private-construction'] })])
      );
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog: null,
      results: [output],
    });
    expect(merged.focuses[0]!.fragments[0]!.mapping.status).toBe('CATALOG_UNAVAILABLE');
    expect(merged.focuses[0]!.privateExtension).toBe(true);
    expect(merged.concepts).toEqual([]);
  });

  it('counts explicit empty streams without inferring a blank visual page or an A1 placement', () => {
    const source = prepareMaterialFocusTextSnapshot({
      sourceKind: 'PASTE',
      sourceId: 'empty',
      userId: 'owner',
      revision: 1,
      name: 'Empty source',
      text: '',
      note: null,
    });
    const coverage = materialFocusAnalysisCoverage(analysis([source.snapshot]), []);
    expect(coverage).toMatchObject({
      expectedChunks: 0,
      readableTextComplete: true,
      sufficientSource: false,
      status: 'INSUFFICIENT_SOURCE',
    });
    expect(coverage.emptyStreams).toHaveLength(1);
    expect(coverage).not.toHaveProperty('level');
  });
});

describe('source-linked focus reconstruction', () => {
  it('merges adjacent source-linked class fragments while preserving combined criteria and original fragments', () => {
    const source = paste('obwohl trotzdem | reflexive pronouns', 'combined', 18),
      input = analysis([source.snapshot]);
    const first = window(input, source.chunks, 0),
      second = window(input, source.chunks, 1);
    const anchor = quote(first, 0, 15);
    const left = parse(
      first,
      result(first, [focus(first, { citations: [anchor], grammarKeys: ['obwohl-trotzdem'] })])
    );
    const right = parse(
      second,
      result(second, [
        focus(second, {
          localId: 'reflexive',
          continuation: quote(second, 0, 15, second.unit.previousId!),
          grammarKeys: ['reflexive-pronouns'],
        }),
      ])
    );
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: [right, left],
    });
    expect(merged.focuses).toHaveLength(1);
    expect(merged.focuses[0]!.fragments).toHaveLength(2);
    expect(merged.concepts.map((item) => item.objectiveId)).toEqual([
      'de.g.obwohl-trotzdem',
      'de.g.reflexive-accusative',
    ]);
    expect(merged.focuses[0]!.groupIds).toEqual(
      expect.arrayContaining(['de.grammar.concession', 'de.grammar.pronouns'])
    );
    expect(merged.focuses[0]!.exposureOnly).toBe(true);
    const reordered = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: [left, right],
    });
    expect(reordered.resultDigest).toBe(merged.resultDigest);
  });

  it('keeps repeated titles and objectives in distinct original classes without explicit continuation', () => {
    const source = paste('First Passiv class. Second Passiv class.', 'separate', 20),
      input = analysis([source.snapshot]);
    const outputs = input.units.map((_unit, index) => {
      const prepared = window(input, source.chunks, index);
      return parse(
        prepared,
        result(prepared, [
          focus(prepared, {
            title: 'Passiv',
            grammarKeys: ['passiv-praesens'],
          }),
        ])
      );
    });
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: outputs,
    });
    expect(merged.focuses).toHaveLength(2);
    expect(merged.concepts).toHaveLength(1);
    expect(merged.concepts[0]!.focusIds).toHaveLength(2);
  });

  it('retains unresolved or ambiguous boundaries rather than merging by titles', () => {
    const source = paste('First original class. Second original class.', 'ambiguous', 22),
      input = analysis([source.snapshot]);
    const first = window(input, source.chunks, 0),
      second = window(input, source.chunks, 1);
    const left = parse(
      first,
      result(first, [focus(first, { localId: 'one' }), focus(first, { localId: 'two' })])
    );
    const right = parse(
      second,
      result(second, [
        focus(second, {
          continuation: quote(second, 0, 10, second.unit.previousId!),
        }),
      ])
    );
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: [left, right],
    });
    expect(merged.focuses).toHaveLength(3);
    expect(merged.unresolvedBoundaries).toEqual([
      { fragmentId: expect.any(String), reason: 'AMBIGUOUS_SOURCE_ANCHOR' },
    ]);
  });

  it('never broadens werden or Plusquamperfekt into a present passive or nachdem objective', () => {
    const source = paste('werden: become, future and other distinct functions');
    const prepared = window(analysis([source.snapshot]), source.chunks);
    const candidate = focus(prepared, {
      grammarKeys: ['werden', 'plusquamperfekt'],
    });
    const mapping = materialFocusCatalogCandidates(catalog, candidate);
    expect(mapping.candidates).toEqual([]);
    expect(mapping.unresolvedGrammarKeys).toEqual(['plusquamperfekt', 'werden']);
    expect(mapping.privateExtension).toBe(true);
  });

  it('preserves exact source headings containing control characters while producing a safe display title', () => {
    const source = paste('Original\0class\nheading 😀');
    const input = analysis([source.snapshot]),
      prepared = window(input, source.chunks),
      citation = quote(prepared);
    const heading = { title: citation.quote, citations: [citation] };
    const output = parse(prepared, result(prepared, [focus(prepared, { heading })]));
    const merged = mergeMaterialSourceFocuses({
      analysis: input,
      catalog,
      results: [output],
    });
    expect(merged.focuses[0]!.title).toBe('Original class heading 😀');
    expect(merged.focuses[0]!.sourceHeadings[0]!.title).toBe('Original\0class\nheading 😀');
    expect(() =>
      parse(prepared, result(prepared, [focus(prepared, { title: 'Unsafe\0title' })]))
    ).toThrow();
    expect(merged.focuses[0]!.objectiveCandidates).toEqual([]);
  });

  it('rejects a conflicting unit replay and preserves incomplete/unknown coverage', () => {
    const source = paste('A precise source');
    const input = analysis([source.snapshot]),
      prepared = window(input, source.chunks);
    const output = parse(prepared, result(prepared));
    expect(() =>
      mergeMaterialSourceFocuses({
        analysis: input,
        catalog,
        results: [output, { ...output, focuses: [focus(prepared)] }],
      })
    ).toThrow('Conflicting');
    const coverage = materialFocusAnalysisCoverage(input, [
      {
        unitId: prepared.unit.id,
        inputDigest: prepared.inputDigest,
        status: 'UNKNOWN',
        resultSha256: null,
        diagnostic: 'Provider outcome unknown.',
      },
    ]);
    expect(coverage).toMatchObject({
      readableTextComplete: false,
      originalContentComplete: false,
      analyzedChunks: 0,
    });
    expect(coverage.failedUnitIds).toEqual([prepared.unit.id]);
    expect(() =>
      materialFocusAnalysisCoverage(input, [
        {
          unitId: prepared.unit.id,
          inputDigest: 'f'.repeat(64),
          status: 'ANALYZED',
          resultSha256: materialFocusAnalysisHash(output),
          diagnostic: null,
        },
      ])
    ).toThrow('private chunk');
  });

  it('refuses an oversized reconstructed focus rather than clipping its source fragments', () => {
    const source = paste('x'.repeat(3200 * 32), 'oversized-focus', 3200);
    const input = analysis([source.snapshot]);
    const outputs = input.units.map((_unit, index) => {
      const prepared = window(input, source.chunks, index),
        citation = quote(prepared, 0, 2000);
      return parse(
        prepared,
        result(prepared, [
          focus(prepared, {
            citations: Array.from({ length: 16 }, () => citation),
            continuation: prepared.unit.previousId
              ? quote(prepared, 0, 2000, prepared.unit.previousId)
              : null,
          }),
        ])
      );
    });
    expect(() =>
      mergeMaterialSourceFocuses({ analysis: input, catalog, results: outputs })
    ).toThrow('frozen detail budget');
  });
});
