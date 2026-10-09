type SuppliedItem = {
  index: number;
  content: { correctIndex: number };
  sourceParts: Array<{ index: number; fieldPath: string[] }>;
};

/** Declared model support for synthetic accepted fixtures, using actual supplied addresses. */
export function readingSupportFixture(item: SuppliedItem) {
  const address = (field: string) => {
    const part = item.sourceParts.find(
      (entry) => entry.fieldPath.length === 1 && entry.fieldPath[0] === field
    );
    if (!part) throw new Error(`Missing fixture ${field} address`);
    return part.index;
  };
  const passage = address('passageText');
  return {
    options: [0, 1, 2, 3].map((optionIndex) => ({
      optionIndex,
      status: optionIndex === item.content.correctIndex ? 'supported' : 'unstated',
      passagePartIndices: optionIndex === item.content.correctIndex ? [passage] : [],
    })),
    constraints: ['actor', 'action', 'time_order', 'negation', 'quantity', 'scope'].map((kind) => ({
      kind,
      status: 'satisfied',
      questionPartIndex: address('question'),
      passagePartIndices: [passage],
      reason: 'Synthetic provider fixture declares this constraint supported.',
    })),
    explanation: {
      status: 'supported',
      explanationPartIndex: address('explanation'),
      passagePartIndices: [passage],
      reason: 'Synthetic provider fixture declares the explanation supported.',
    },
  };
}

export function requiresReadingSupport(options: unknown): boolean {
  const schema = (
    options as {
      jsonSchema?: { schema?: { properties?: { items?: { items?: unknown } } } };
    }
  )?.jsonSchema?.schema?.properties?.items?.items;
  const required = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const node = value as { required?: string[]; anyOf?: unknown[] };
    return node.required?.includes('answerSupport') === true || node.anyOf?.some(required) === true;
  };
  return required(schema);
}

export function withReadingSupportFixture<T extends { content: string }>(
  messages: Array<{ content: string }>,
  options: unknown,
  response: T
): T {
  if (!requiresReadingSupport(options)) return response;
  let payload: { items: SuppliedItem[] };
  let parsed: { items?: Array<Record<string, unknown>> };
  try {
    payload = JSON.parse(messages[0]!.content);
    parsed = JSON.parse(response.content);
  } catch {
    return response;
  }
  if (!Array.isArray(parsed.items)) return response;
  return {
    ...response,
    content: JSON.stringify({
      ...parsed,
      items: parsed.items.map((row) => {
        if (Object.hasOwn(row, 'answerSupport')) return row;
        const item = payload.items.find((entry) => entry.index === row.index);
        if (!item) return row;
        return { ...row, answerSupport: readingSupportFixture(item) };
      }),
    }),
  };
}
