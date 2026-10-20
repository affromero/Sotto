/** Database text metadata must remain representable. Exact source quotations use bytea. */
export function requireVocabularyTextMetadata(word: { lemma: string; gloss: string; pos: string }) {
  if (
    [word.lemma, word.gloss, word.pos].some(
      (text) => !text.isWellFormed() || text.includes('\u0000')
    )
  )
    throw new Error('Vocabulary metadata contains unsupported database text.');
}

export function decodeVocabularySourceQuote(source: {
  quote: string | null;
  quoteBytes: Uint8Array | null;
}) {
  if (source.quoteBytes !== null)
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.quoteBytes);
  if (source.quote === null)
    throw new Error('The exact vocabulary source quotation is unavailable.');
  return source.quote;
}
