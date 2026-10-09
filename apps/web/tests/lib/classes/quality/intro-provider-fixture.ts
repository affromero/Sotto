interface FixtureResponse {
  content: string;
  model: string;
}

type FixturePart = { index: number; fieldPath: string[]; quote: string };
type FixtureFinding = {
  fieldPath: string[];
  quote: string;
  issue: string;
  rule: string;
  defect: string;
  correction: string | null;
  counterexample: string | null;
};

/** Select only an exact supplied leaf at the external model fixture boundary. */
export function teachingFindingFixture(finding: FixtureFinding, parts: FixturePart[]) {
  const path = finding.fieldPath[0] === 'content' ? finding.fieldPath.slice(1) : finding.fieldPath;
  return {
    sourcePartIndex:
      parts.find(
        (part) =>
          JSON.stringify(part.fieldPath) === JSON.stringify(path) &&
          finding.quote.trim() &&
          (part.quote.includes(finding.quote) || finding.quote.includes(part.quote))
      )?.index ?? -1,
    issue: finding.issue,
    rule: finding.rule,
    defect: finding.defect,
    remedy: {
      kind: finding.correction === null ? 'counterexample' : 'correction',
      text: finding.correction ?? finding.counterexample,
    },
  };
}

function shapeEvidenceFixture(messages: Array<{ content: string }>, response: FixtureResponse) {
  const parsed = JSON.parse(response.content);
  if (
    parsed.items.some(
      (item: { newFindings?: unknown; findings?: Array<{ sourcePartIndex?: number }> }) =>
        item.newFindings !== undefined ||
        item.findings?.some((finding) => finding.sourcePartIndex !== undefined)
    )
  )
    return response;
  const payload = JSON.parse(messages[0]!.content);
  return {
    ...response,
    content: JSON.stringify({
      items: parsed.items.map(
        (item: {
          index: number;
          findings: FixtureFinding[];
          criticDecisions?: Array<{ findingIndex: number; decision: string; reason: string }>;
        }) => {
          const supplied = payload.items.find(
            (entry: { index: number }) => entry.index === item.index
          );
          const criticisms =
            payload.criticisms?.items.find((entry: { index: number }) => entry.index === item.index)
              ?.findings ?? [];
          const additions = item.findings.filter(
            (finding) =>
              !item.criticDecisions?.some(
                (decision) =>
                  decision.decision === 'supported' &&
                  JSON.stringify(criticisms[decision.findingIndex]?.fieldPath) ===
                    JSON.stringify(
                      finding.fieldPath[0] === 'content'
                        ? finding.fieldPath.slice(1)
                        : finding.fieldPath
                    ) &&
                  criticisms[decision.findingIndex]?.issue === finding.issue &&
                  criticisms[decision.findingIndex]?.defect === finding.defect
              )
          );
          const findings = additions.map((finding) =>
            teachingFindingFixture(finding, supplied?.sourceParts ?? [])
          );
          if (!item.criticDecisions) return { index: item.index, findings };
          return {
            index: item.index,
            criticDecisions: item.criticDecisions,
            newFindings: findings,
          };
        }
      ),
    }),
  };
}

export function emptyTeachingCriticFixture(messages: Array<{ content: string }>): FixtureResponse {
  const payload = JSON.parse(messages[0]!.content);
  return {
    content: JSON.stringify({
      items: payload.items.map(({ index }: { index: number }) => ({ index, findings: [] })),
    }),
    model: 'm',
  };
}

/** Translate compatibility fixtures only at the external mock model boundary. */
export function shapeTeachingProviderFixture(
  system: string,
  messages: Array<{ content: string }>,
  options: unknown,
  response: FixtureResponse
): FixtureResponse {
  if (!system.trim()) return response;
  const name = (options as { jsonSchema?: { name: string } }).jsonSchema?.name;
  if (name !== 'class_teaching_critic' && name !== 'class_teaching_adjudicator') return response;
  try {
    const parsed = JSON.parse(response.content);
    if (
      !Array.isArray(parsed.items) ||
      parsed.items.some(
        (item: Record<string, unknown>) =>
          Object.hasOwn(item, 'findings') || Object.hasOwn(item, 'criticDecisions')
      )
    )
      return parsed.items?.every((item: { findings?: FixtureFinding[] }) =>
        Array.isArray(item.findings)
      )
        ? shapeEvidenceFixture(messages, response)
        : response;
    if (
      parsed.items.some(
        (item: { acceptable: unknown; issues: unknown; feedback: unknown }) =>
          typeof item.acceptable !== 'boolean' ||
          !Array.isArray(item.issues) ||
          !Array.isArray(item.feedback) ||
          item.feedback.some(
            (text: unknown) => typeof text !== 'string' || !text.trim() || text.length > 300
          ) ||
          (item.acceptable
            ? item.issues.length !== 0 || item.feedback.length !== 0
            : item.issues.length === 0 || item.feedback.length === 0)
      )
    )
      return response;
    const payload = JSON.parse(messages[0]!.content);
    const leaf = (
      value: unknown,
      fieldPath: string[] = []
    ): { fieldPath: string[]; quote: string } => {
      if (typeof value === 'string') return { fieldPath, quote: value.slice(0, 120) };
      if (value && typeof value === 'object')
        for (const [key, child] of Object.entries(value)) {
          const found = leaf(child, [...fieldPath, key]);
          if (found.quote.trim()) return found;
        }
      return { fieldPath, quote: '' };
    };
    const shaped = {
      ...response,
      content: JSON.stringify({
        items: parsed.items.map(
          (item: { index: number; acceptable: boolean; issues: string[]; feedback: string[] }) => {
            const content = payload.items.find(
              (entry: { index: number }) => entry.index === item.index
            )?.content;
            const findings = item.acceptable
              ? []
              : [...new Set(item.issues)].slice(0, 3).map((issue) => ({
                  issue,
                  ...leaf(content),
                  rule: 'fixture teaching contract',
                  defect: item.feedback[0]?.slice(0, 120) ?? '',
                  correction: 'Use accurate supported teaching.',
                  counterexample: null,
                }));
            if (name === 'class_teaching_critic') return { index: item.index, findings };
            const criticisms = payload.criticisms.items.find(
              (entry: { index: number }) => entry.index === item.index
            ).findings;
            return {
              ...item,
              findings,
              criticDecisions: criticisms.map((_: unknown, findingIndex: number) => ({
                findingIndex,
                decision: item.acceptable ? 'dismissed' : 'supported',
                reason: 'Fixture adjudication of the cited field.',
              })),
            };
          }
        ),
      }),
    };
    return shapeEvidenceFixture(messages, shaped);
  } catch {
    return response;
  }
}

/** Convert persisted-string fixtures only at the model response boundary. */
export function scopedIntroFixture(value: Record<string, unknown>): Record<string, unknown> {
  const examples = Array.isArray(value.examples) ? value.examples : [];
  const atom = (text: unknown): unknown => {
    if (typeof text !== 'string') return text;
    const quoted = text.match(/^„([^“]+)“: /);
    const matchingIndex = examples.findIndex(
      (example) => example && typeof example === 'object' && example.target === quoted?.[1]
    );
    return {
      text: quoted ? text.slice(quoted[0].length) : text,
      exampleIndex: matchingIndex >= 0 ? matchingIndex : 0,
    };
  };
  const collection = (entries: unknown): unknown => {
    if (Array.isArray(entries)) return entries.map(atom);
    if (entries && typeof entries === 'object')
      return Object.fromEntries(
        Object.entries(entries).map(([index, text]) => [index, atom(text)])
      );
    return entries;
  };
  return {
    ...value,
    ...(Object.hasOwn(value, 'about')
      ? {
          about:
            typeof value.about === 'string'
              ? { exampleIndex: (atom(value.about) as { exampleIndex: number }).exampleIndex }
              : value.about,
        }
      : {}),
    ...(Object.hasOwn(value, 'focus') ? { focus: collection(value.focus) } : {}),
    ...(Object.hasOwn(value, 'tips') ? { tips: collection(value.tips) } : {}),
  };
}

function generationVisualFixture(value: Record<string, unknown>): Record<string, unknown> {
  const visuals = value.visuals;
  if (visuals === undefined) return { ...value, visuals: null };
  if (!visuals || typeof visuals !== 'object' || Array.isArray(visuals)) return value;
  const fields = visuals as Record<string, unknown>;
  return {
    ...value,
    visuals: {
      ...fields,
      timeline: fields.timeline === undefined ? null : fields.timeline,
      contrast: fields.contrast === undefined ? null : fields.contrast,
      callouts: Array.isArray(fields.callouts)
        ? fields.callouts.map((callout: unknown) =>
            callout && typeof callout === 'object' && !Array.isArray(callout)
              ? { tone: 'blue', ...callout }
              : callout
          )
        : fields.callouts === undefined
          ? []
          : fields.callouts,
      links: fields.links === undefined ? [] : fields.links,
    },
  };
}

/** Simulate a model honoring the requested output schema in legacy full-object fixtures. */
function shapeLegacyIntroFixture(
  system: string,
  messages: Array<{ content: string }>,
  options: unknown,
  response: FixtureResponse
): FixtureResponse {
  try {
    if (!system.startsWith('Independently review')) {
      const properties = (
        options as {
          jsonSchema?: { schema: { properties?: Record<string, unknown> } };
        }
      ).jsonSchema?.schema.properties;
      if (!properties || Object.keys(properties).length >= 5) return response;
      const parsed: unknown = JSON.parse(response.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return response;
      // Explicit patches retain extra keys so unauthorized writes remain testable.
      if (!Array.isArray((parsed as Record<string, unknown>).examples)) return response;
      return {
        ...response,
        content: JSON.stringify(
          Object.fromEntries(
            Object.entries(parsed).filter(([field]) => Object.hasOwn(properties, field))
          )
        ),
      };
    }
    const supplied = JSON.parse(messages[0]!.content).items;
    if (!supplied[0]?.content?.address) return response;
    const parsed = JSON.parse(response.content);
    if (parsed.items?.length !== 1 || parsed.items[0].index !== 0) return response;
    const original = parsed.items[0];
    if (!Array.isArray(original.feedback)) return response;
    if (original.acceptable && original.issues?.length === 0 && original.feedback.length === 0) {
      return {
        ...response,
        content: JSON.stringify({
          items: supplied.map(({ index }: { index: number }) => ({
            index,
            acceptable: true,
            issues: [],
            feedback: [],
          })),
        }),
      };
    }
    if (
      original.acceptable ||
      !Array.isArray(original.issues) ||
      original.issues.length === 0 ||
      original.feedback.length === 0
    )
      return response;
    const defectText = original.feedback.join(' ').toLowerCase();
    const addressPatterns: Array<[string, RegExp]> = [
      ['purpose', /purpose/],
      ['about', /about/],
      ['focus', /focus(?:\[(\d+)\])?/],
      ['tips', /tips?(?:\[(\d+)\])?/],
      ['visuals', /visual/],
      ['examples', /examples?(?:\[(\d+)\])?|target|meaning|auxiliary|verb/],
    ];
    const targetMatch = addressPatterns
      .map(([field, pattern]) => ({ field, match: defectText.match(pattern) }))
      .find(({ match }) => match);
    const targetField = targetMatch?.field ?? 'purpose';
    const targetAddressIndex = targetMatch?.match?.[1]
      ? Number(targetMatch.match[1])
      : targetField === 'examples' || targetField === 'focus' || targetField === 'tips'
        ? 0
        : undefined;
    const targetIndex = supplied.findIndex(
      ({ content }: { content: { address: { field: string; index?: number } } }) =>
        content.address.field === targetField && content.address.index === targetAddressIndex
    );
    return {
      ...response,
      content: JSON.stringify({
        items: supplied.map(({ index }: { index: number }) =>
          targetIndex >= 0 && index === targetIndex
            ? { ...original, index }
            : { index, acceptable: true, issues: [], feedback: [] }
        ),
      }),
    };
  } catch {
    return response;
  }
}

export function shapeIntroProviderFixture(
  system: string,
  messages: Array<{ content: string }>,
  options: unknown,
  response: FixtureResponse
): FixtureResponse {
  const schemaName = (options as { jsonSchema?: { name: string } }).jsonSchema?.name;
  if (schemaName === 'class_teaching_critic' || schemaName === 'class_teaching_adjudicator')
    return shapeTeachingProviderFixture(system, messages, options, response);
  if (schemaName === 'class_intro_generation' || schemaName === 'class_intro_repair') {
    try {
      const legacy = shapeLegacyIntroFixture(system, messages, options, response);
      const parsed: unknown = JSON.parse(legacy.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return response;
      return {
        ...legacy,
        content: JSON.stringify(
          scopedIntroFixture(
            schemaName === 'class_intro_generation'
              ? generationVisualFixture(parsed as Record<string, unknown>)
              : (parsed as Record<string, unknown>)
          )
        ),
      };
    } catch {
      return response;
    }
  }
  if (schemaName !== 'class_intro_critic' && schemaName !== 'class_intro_adjudicator')
    return shapeLegacyIntroFixture(system, messages, options, response);
  try {
    const parsed = JSON.parse(response.content);
    if (
      !Array.isArray(parsed.items) ||
      parsed.items.some((item: { findings?: unknown }) => item.findings !== undefined)
    )
      return parsed.items?.every((item: { findings?: FixtureFinding[] }) =>
        Array.isArray(item.findings)
      )
        ? shapeEvidenceFixture(messages, response)
        : response;
    if (
      parsed.items.some((item: { acceptable: unknown; issues: unknown; feedback: unknown }) => {
        if (
          typeof item.acceptable !== 'boolean' ||
          !Array.isArray(item.issues) ||
          !Array.isArray(item.feedback)
        )
          return true;
        if (
          item.feedback.some(
            (text: unknown) => typeof text !== 'string' || !text.trim() || text.length > 300
          )
        )
          return true;
        return item.acceptable
          ? item.issues.length !== 0 || item.feedback.length !== 0
          : item.issues.length === 0 || item.feedback.length === 0;
      })
    )
      return response;
    const shaped = JSON.parse(
      shapeLegacyIntroFixture('Independently review', messages, options, response).content
    );
    const payload = JSON.parse(messages[0]!.content);
    const leaf = (
      value: unknown,
      prefix: string[] = []
    ): { fieldPath: string[]; quote: string } => {
      if (typeof value === 'string') return { fieldPath: prefix, quote: value.slice(0, 120) };
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (child === null || child === undefined) continue;
          const found = leaf(child, [...prefix, key]);
          if (found.quote) return found;
        }
      }
      return { fieldPath: prefix, quote: '' };
    };
    const items = shaped.items.map(
      (item: { index: number; acceptable: boolean; issues: string[]; feedback: string[] }) => {
        const fields = payload.items.find((entry: { index: number }) => entry.index === item.index)
          ?.content.fields;
        const findings = item.acceptable
          ? []
          : [...new Set(item.issues)].slice(0, 3).map((issue) => ({
              issue,
              ...leaf(fields),
              rule: 'fixture teaching contract',
              defect: item.feedback[0]?.slice(0, 120) ?? '',
              correction: 'Use accurate supported teaching.',
              counterexample: null,
            }));
        if (schemaName === 'class_intro_critic') return { index: item.index, findings };
        const criticism = payload.criticisms.items.find(
          (entry: { index: number }) => entry.index === item.index
        );
        return {
          ...item,
          findings,
          criticDecisions: criticism.findings.map((_: unknown, findingIndex: number) => ({
            findingIndex,
            decision: item.acceptable ? 'dismissed' : 'supported',
            reason: item.acceptable
              ? 'The cited field satisfies the teaching contract.'
              : 'The cited teaching defect is supported.',
          })),
        };
      }
    );
    return shapeEvidenceFixture(messages, { ...response, content: JSON.stringify({ items }) });
  } catch {
    return response;
  }
}
