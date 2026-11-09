/** Exercise the real direction orchestration while replacing the paid model boundary. */
export function prerequisiteDirectionFixture(
  messages: Array<{ content: string }>,
  options?: { jsonSchema?: { name?: string } }
) {
  const name = options?.jsonSchema?.name;
  if (name === 'class_prerequisite_directions_review')
    return {
      model: 'fixture',
      content: JSON.stringify({
        faithful: true,
        understandable: true,
        challengePreserved: true,
        answersConcealed: true,
        issues: [],
      }),
    };
  if (name !== 'class_prerequisite_directions') return null;
  const payload = JSON.parse(messages[0]!.content) as {
    guided: unknown;
    tasks: Array<{ sectionId: string; taskId: string; kind: string }>;
  };
  return {
    model: 'fixture',
    content: JSON.stringify({
      guided: payload.guided ? 'Pide una bebida con cortesía.' : null,
      tasks: payload.tasks.map(({ sectionId, taskId, kind }) => ({
        sectionId,
        taskId,
        kind,
        instruction: 'Lee la consigna y responde.',
      })),
    }),
  };
}
