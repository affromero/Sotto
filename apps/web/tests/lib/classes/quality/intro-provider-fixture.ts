interface FixtureResponse {
  content: string;
  model: string;
}

/** Simulate a model honoring the requested output schema in legacy full-object fixtures. */
export function shapeIntroProviderFixture(
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
    if (!supplied[0]?.content?.auditFields) return response;
    const parsed = JSON.parse(response.content);
    if (parsed.items?.length !== 1 || parsed.items[0].index !== 0) return response;
    const original = parsed.items[0];
    if (!Array.isArray(original.feedback)) return response;
    const defectText = original.feedback.join(' ').toLowerCase();
    const scopePatterns: Array<[string, RegExp]> = [
      ['purpose', /purpose/],
      ['about', /about/],
      ['focus', /focus|tips/],
      ['visuals', /visual/],
      ['examples', /example|target|meaning|auxiliary|verb/],
    ];
    const targetScope =
      scopePatterns.find(([, pattern]) => pattern.test(defectText))?.[0] ?? 'purpose';
    const targetIndex = supplied.findIndex(({ content }: { content: { auditFields: string[] } }) =>
      content.auditFields.includes(targetScope)
    );
    return {
      ...response,
      content: JSON.stringify({
        items: supplied.map(({ index }: { index: number }) =>
          index === targetIndex
            ? { ...original, index }
            : { index, acceptable: true, issues: [], feedback: [] }
        ),
      }),
    };
  } catch {
    return response;
  }
}
