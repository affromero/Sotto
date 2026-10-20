import type { ClassIntro, ClassIntroExample } from '../class-intro';

interface AuthoredObservation {
  readonly text: string;
  readonly exampleIndex: number;
}

interface BoundObservation {
  readonly index: number;
  readonly body: string;
  readonly rendered: string;
}

export interface IntroRepairBindings {
  readonly overview: { readonly index: number; readonly rendered: string };
  readonly targets: readonly string[];
  readonly focus: readonly BoundObservation[];
  readonly tips: readonly BoundObservation[];
}

export function captureIntroBindings(
  intro: ClassIntro,
  authored: {
    about: { exampleIndex: number };
    focus: readonly AuthoredObservation[];
    tips: readonly AuthoredObservation[];
  }
): IntroRepairBindings | null {
  if (!intro.examples[authored.about.exampleIndex]) return null;
  const capture = (field: 'focus' | 'tips'): readonly BoundObservation[] | null => {
    if (authored[field].length !== intro[field].length) return null;
    const observations: BoundObservation[] = [];
    for (const [position, atom] of authored[field].entries()) {
      const example = intro.examples[atom.exampleIndex];
      if (!example) return null;
      const prefix = `„${example.target}“: `;
      const body = atom.text.startsWith(prefix) ? atom.text.substring(prefix.length) : atom.text;
      if (intro[field][position] !== prefix + body) return null;
      observations.push(Object.freeze({ index: atom.exampleIndex, body, rendered: prefix + body }));
    }
    return Object.freeze(observations);
  };
  const focus = capture('focus');
  const tips = capture('tips');
  if (!focus || !tips) return null;
  return Object.freeze({
    overview: Object.freeze({ index: authored.about.exampleIndex, rendered: intro.about }),
    targets: Object.freeze(intro.examples.map(({ target }) => target)),
    focus,
    tips,
  });
}

export function renderBoundIntroRepair(
  bindings: IntroRepairBindings,
  original: ClassIntro,
  examples: readonly ClassIntroExample[],
  renderOverview: (index: number) => string | null,
  renderObservation: (body: string, target: string) => string
): Pick<ClassIntro, 'about' | 'focus' | 'tips'> | null {
  if (
    bindings.overview.rendered !== original.about ||
    bindings.targets.length !== original.examples.length ||
    examples.length !== original.examples.length ||
    bindings.targets.some((target, index) => target !== original.examples[index].target)
  )
    return null;

  const render = (field: 'focus' | 'tips'): string[] | null => {
    if (bindings[field].length !== original[field].length) return null;
    const result: string[] = [];
    for (const [position, observation] of bindings[field].entries()) {
      const example = examples[observation.index];
      if (
        !Number.isInteger(observation.index) ||
        observation.index < 0 ||
        !example ||
        observation.rendered !== original[field][position] ||
        renderObservation(observation.body, bindings.targets[observation.index]) !==
          observation.rendered
      )
        return null;
      result.push(
        example.target === bindings.targets[observation.index]
          ? observation.rendered
          : renderObservation(observation.body, example.target)
      );
    }
    return result;
  };
  const focus = render('focus');
  const tips = render('tips');
  const selected = examples[bindings.overview.index];
  if (!focus || !tips || !selected || !Number.isInteger(bindings.overview.index)) return null;
  const about =
    selected.target === bindings.targets[bindings.overview.index]
      ? bindings.overview.rendered
      : renderOverview(bindings.overview.index);
  return about === null ? null : { about, focus, tips };
}
