export const vocabularyEntries = [
  ['Bahnhof', 'station'],
  ['Fahrkarte', 'ticket'],
  ['Bäckerei', 'bakery'],
  ['Rechnung', 'bill'],
  ['Wohnung', 'apartment'],
  ['Schlüssel', 'key'],
  ['Fenster', 'window'],
  ['Treppe', 'stairs'],
  ['Wetter', 'weather'],
  ['Wolke', 'cloud'],
  ['Sonne', 'sun'],
  ['Regen', 'rain'],
  ['Termin', 'appointment'],
  ['Freundschaft', 'friendship'],
  ['Weltanschauung', 'worldview'],
];
const meanings = new Map(vocabularyEntries);

function requiredWords(input) {
  const text = input.passageText ?? input.text;
  const tokens = [...new Intl.Segmenter('de', { granularity: 'word' }).segment(text)].filter(
    (token) => token.isWordLike
  );
  return tokens.flatMap((token, index) => {
    const gloss = meanings.get(token.segment);
    if (
      !gloss ||
      (input.requiredSpan &&
        (token.index < input.requiredSpan.start || token.index >= input.requiredSpan.end))
    )
      return [];
    return [
      {
        lemma: token.segment,
        gloss,
        pos: 'noun',
        sourceSpan: { startWordIndex: index, endWordIndex: index },
        questionIndices: [],
        start: token.index,
      },
    ];
  });
}
export function vocabularyInventoryFixture(input) {
  const required = requiredWords(input);
  return {
    words: required.map(({ start, ...word }) => word),
    coverage: input.lines.map((line) => {
      const entries = required.flatMap((word, index) =>
        word.start >= line.start && word.start < line.end ? [index] : []
      );
      return {
        lineIndex: line.index,
        entries,
        classification: entries.length ? 'VOCABULARY' : 'CONTEXT',
      };
    }),
  };
}
export function vocabularyCoverageFixture(input) {
  const required = requiredWords(input);
  const missingEntries = required
    .filter(
      (word) =>
        !input.inventory.words.some(
          (candidate) =>
            candidate.lemma === word.lemma &&
            candidate.sourceSpan.startWordIndex === word.sourceSpan.startWordIndex
        )
    )
    .map((word) => word.lemma);
  return { complete: missingEntries.length === 0, missingEntries };
}
export function vocabularyMetadataFixture(input) {
  if (
    !input.items.length ||
    input.items.length > 5 ||
    input.items.some(
      ({ content }) =>
        !meanings.has(content.lemma) ||
        meanings.get(content.lemma) !== content.gloss ||
        content.sourceQuote !== content.lemma ||
        content.questionIndices.length
    )
  )
    throw new Error('Unexpected source vocabulary metadata fixture');
  return {
    items: input.items.map(({ index }) => ({
      index,
      metadata: { acceptable: true, issues: [], feedback: [] },
      associations: [],
    })),
  };
}
