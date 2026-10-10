import {
  validateNormalizedListeningTurns,
  type NormalizedListeningTurn,
} from '@/lib/classes/quality/listening-audit/projection';
import {
  buildListeningSourceUnits,
  parseListeningPassageExtractionResponse,
} from '@/lib/classes/quality/listening-audit/passage-witness';

/** Exact turn declarations for authored, single-line synthetic transcript fixtures. */
export function listeningTurnsFixture(passageText: string) {
  const turns = passageText.split('\n').map((line, index) => {
    const separator = line.indexOf(': ');
    if (separator < 1) throw new Error('Synthetic listening fixtures require speaker labels.');
    return {
      turnIndex: index + 1,
      speaker: line.slice(0, separator),
      text: line.slice(separator + 2),
    };
  });
  return validateNormalizedListeningTurns(turns, passageText);
}

/** Explicit literal account declaration for synthetic integration fixtures. */
export function listeningExtractionFixture(
  turns: readonly NormalizedListeningTurn[],
  targetLang = 'de'
) {
  const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
  const table = buildListeningSourceUnits(fields, turns, targetLang);
  return {
    unitAccounts: Object.fromEntries(
      table.units.map((unit) => [String(unit.unitIndex), `Synthetic source account: ${unit.text}`])
    ),
    pairs: [],
  };
}

/** Explicit judge declaration when the synthetic critic proposed no teaching pairs. */
export function listeningWitnessFixture() {
  return { pairDecisions: [], additionalPairs: [] };
}

export function normalizedListeningExtractionFixture(
  turns: readonly NormalizedListeningTurn[],
  targetLang = 'de'
) {
  const fields = { passageText: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n') };
  return parseListeningPassageExtractionResponse(
    listeningExtractionFixture(turns, targetLang),
    fields,
    turns,
    targetLang
  );
}

export function withListeningWitnessFixture<T extends { content: string }>(
  messages: Array<{ content: string }>,
  options: unknown,
  response: T
): T {
  const schema = (options as { jsonSchema?: { schema?: unknown } })?.jsonSchema?.schema;
  const required = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const node = value as { required?: string[] };
    return (
      node.required?.includes('passageWitness') === true ||
      Object.values(value).some((child) =>
        Array.isArray(child) ? child.some(required) : required(child)
      )
    );
  };
  if (!required(schema)) return response;
  try {
    const payload = JSON.parse(messages[0]!.content);
    const parsed = JSON.parse(response.content);
    if (!Array.isArray(payload.listeningUnits?.units) || !Array.isArray(parsed.items))
      return response;
    const critic =
      (options as { jsonSchema?: { name?: string } }).jsonSchema?.name === 'class_teaching_critic';
    const proposed = payload.criticisms?.items.find(
      (row: { index: number }) => row.index === 0
    )?.passagePairs;
    if (!critic && (!Array.isArray(proposed) || proposed.length !== 0)) return response;
    const declaration = critic
      ? {
          unitAccounts: Object.fromEntries(
            payload.listeningUnits.units.map((unit: { unitIndex: number; text: string }) => [
              String(unit.unitIndex),
              `Synthetic source account: ${unit.text}`,
            ])
          ),
          pairs: [],
        }
      : listeningWitnessFixture();
    return {
      ...response,
      content: JSON.stringify({
        ...parsed,
        items: parsed.items.map((row: Record<string, unknown>) =>
          row.index === 0 && !Object.hasOwn(row, 'passageWitness')
            ? { ...row, passageWitness: declaration }
            : row
        ),
      }),
    };
  } catch {
    return response;
  }
}
