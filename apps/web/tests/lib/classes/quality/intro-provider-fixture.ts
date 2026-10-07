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
