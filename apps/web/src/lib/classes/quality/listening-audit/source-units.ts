import { z } from 'zod';
import { buildTeachingSourceParts } from '../teaching-source/protocol';
import { validateNormalizedListeningTurns, type NormalizedListeningTurn } from './projection';

const index = z.number().int().nonnegative();
export const listeningSourceBindingShape = {
  locale: z.string().min(1),
  units: z
    .array(z.object({ turnIndex: z.number().int().positive(), start: index, end: index }).strict())
    .min(1),
};
const bindingSchema = z.object(listeningSourceBindingShape).strict();
export type ListeningSourceBinding = z.infer<typeof bindingSchema>;

export interface ListeningSourceUnit {
  unitIndex: number;
  turnIndex: number;
  speaker: string;
  text: string;
  meaningMaxChars: number;
  start: number;
  end: number;
  sourcePartIndices: number[];
}

export interface ListeningSourceTable {
  locale: string;
  units: ListeningSourceUnit[];
}

function canonicalLocale(locale: string) {
  if (typeof locale !== 'string' || !locale) throw new Error('Listening review requires a locale.');
  const locales = Intl.getCanonicalLocales(locale);
  if (locales.length !== 1) throw new Error('Listening review requires one locale.');
  return locales[0];
}

function sourceContext(fields: unknown, turns: readonly NormalizedListeningTurn[]) {
  if (!fields || typeof fields !== 'object' || !Object.hasOwn(fields, 'passageText'))
    throw new Error('Listening passage witness requires passage fields.');
  const passageText = (fields as Record<string, unknown>).passageText;
  if (typeof passageText !== 'string' || !passageText.trim())
    throw new Error('Listening passage witness requires a nonempty passage.');
  const normalized = validateNormalizedListeningTurns(turns, passageText);
  let partOffset = 0;
  const partSpans = buildTeachingSourceParts(fields)
    .filter((part) => part.fieldPath.length === 1 && part.fieldPath[0] === 'passageText')
    .map((part) => {
      const start = passageText.indexOf(part.quote, partOffset);
      if (start < 0) throw new Error('Listening passage source address is not bound.');
      partOffset = start + part.quote.length;
      return { index: part.index, start, end: partOffset };
    });
  if (!partSpans.length) throw new Error('Listening passage requires source addresses.');
  let turnOffset = 0;
  const turnSpans = normalized.map((turn) => {
    const start = turnOffset + turn.speaker.length + 2;
    const end = start + turn.text.length;
    turnOffset = end + 1;
    return { ...turn, start, end };
  });
  return { passageText, turnSpans, partSpans };
}

function sourceUnit(
  context: ReturnType<typeof sourceContext>,
  turn: ReturnType<typeof sourceContext>['turnSpans'][number],
  span: ListeningSourceBinding['units'][number],
  unitIndex: number
): ListeningSourceUnit {
  const text = context.passageText.slice(span.start, span.end);
  const sourcePartIndices = context.partSpans
    .filter((part) => part.start < span.end && part.end > span.start)
    .map((part) => part.index);
  if (!sourcePartIndices.length) throw new Error('Listening source unit is not bound.');
  return {
    unitIndex,
    turnIndex: turn.turnIndex,
    speaker: turn.speaker,
    text,
    meaningMaxChars: Math.max(120, text.length * 3),
    start: span.start,
    end: span.end,
    sourcePartIndices,
  };
}

/** Reconstruct retained units from exact spans without rerunning a later ICU segmenter. */
export function validateListeningSourceBinding(
  value: ListeningSourceBinding,
  fields: unknown,
  turns: readonly NormalizedListeningTurn[]
): ListeningSourceTable {
  const binding = bindingSchema.parse({ locale: value.locale, units: value.units });
  const locale = canonicalLocale(binding.locale);
  if (locale !== binding.locale) throw new Error('Listening source locale is not canonical.');
  const context = sourceContext(fields, turns);
  const units: ListeningSourceUnit[] = [];
  let position = 0;
  for (const turn of context.turnSpans) {
    let offset = turn.start;
    while (binding.units[position]?.turnIndex === turn.turnIndex) {
      const span = binding.units[position];
      if (span.start !== offset || span.end <= span.start || span.end > turn.end)
        throw new Error('Listening source units must partition their exact spoken turn.');
      units.push(sourceUnit(context, turn, span, position));
      offset = span.end;
      position += 1;
    }
    if (offset !== turn.end)
      throw new Error('Listening source units must cover every complete spoken turn.');
  }
  if (position !== binding.units.length)
    throw new Error('Listening source units contain an unknown or reordered turn.');
  return { locale, units };
}

/** Capture sentence addresses once using the explicitly configured target language. */
export function buildListeningSourceUnits(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  targetLang: string
): ListeningSourceTable {
  const locale = canonicalLocale(targetLang);
  if (Intl.Segmenter.supportedLocalesOf([locale], { localeMatcher: 'lookup' }).length !== 1)
    throw new Error('Listening source locale is unsupported.');
  const context = sourceContext(fields, turns);
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const spans: ListeningSourceBinding['units'] = [];
  for (const turn of context.turnSpans) {
    for (const segment of segmenter.segment(turn.text)) {
      spans.push({
        turnIndex: turn.turnIndex,
        start: turn.start + segment.index,
        end: turn.start + segment.index + segment.segment.length,
      });
    }
  }
  return validateListeningSourceBinding({ locale, units: spans }, fields, turns);
}

export function retainListeningSourceBinding(table: ListeningSourceTable): ListeningSourceBinding {
  return {
    locale: table.locale,
    units: table.units.map(({ turnIndex, start, end }) => ({ turnIndex, start, end })),
  };
}

/** Resolve every occurrence of exact canonical passage chunks to their overlapping turns. */
export function listeningSourcePartTurnIndices(
  fields: unknown,
  turns: readonly NormalizedListeningTurn[],
  quotes: readonly string[]
): number[] {
  const context = sourceContext(fields, turns);
  const indices = new Set<number>();
  for (const quote of quotes) {
    const canonical = context.partSpans.some(
      (part) => context.passageText.slice(part.start, part.end) === quote
    );
    if (!canonical) throw new Error('Listening repair quote is not a canonical passage chunk.');
    const parts: Array<{ start: number; end: number }> = [];
    let start = context.passageText.indexOf(quote);
    while (start >= 0) {
      parts.push({ start, end: start + quote.length });
      start = context.passageText.indexOf(quote, start + 1);
    }
    const matching = context.turnSpans.filter((turn) =>
      parts.some((part) => part.start < turn.end && part.end > turn.start)
    );
    if (!matching.length) throw new Error('Listening repair quote has no spoken turn.');
    for (const turn of matching) indices.add(turn.turnIndex);
  }
  return [...indices].sort((left, right) => left - right);
}
