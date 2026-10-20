import { describe, expect, it } from 'vitest';
import type { ClassIntro } from '@/lib/classes/class-intro';
import { captureIntroBindings, renderBoundIntroRepair } from '@/lib/classes/intro/bindings';

function lesson() {
  const target = 'Nous prenons le train.';
  const body = 'Le sujet est au pluriel.';
  const quote = (text: string, sentence: string) => `„${sentence}“: ${text}`;
  const intro: ClassIntro = {
    purpose: 'Préparer un voyage.',
    about: target,
    examples: [0, 1].map(() => ({ target, meaning: target, note: 'Une action collective.' })),
    focus: [quote(body, target)],
    tips: [quote('Observer la terminaison.', target)],
  };
  const authored = {
    about: { exampleIndex: 1 },
    focus: [{ text: body, exampleIndex: 1 }],
    tips: [{ text: 'Observer la terminaison.', exampleIndex: 0 }],
  };
  const bindings = captureIntroBindings(intro, authored);
  if (!bindings) throw new Error('Invalid lesson fixture');
  const render = (original: ClassIntro, examples = original.examples) =>
    renderBoundIntroRepair(bindings, original, examples, (index) => examples[index].target, quote);
  return { intro, authored, bindings, render, quote };
}

describe('bound introduction observations', () => {
  it('updates only references to the replaced example even when targets were equal', () => {
    const { intro, render } = lesson();
    const examples = [intro.examples[0], { ...intro.examples[1], target: 'Nous prenons le bus.' }];
    expect(render(intro, examples)).toEqual({
      about: 'Nous prenons le bus.',
      focus: ['„Nous prenons le bus.“: Le sujet est au pluriel.'],
      tips: intro.tips,
    });
    expect(intro.examples[1].target).toBe('Nous prenons le train.');
  });

  it('retains captured bodies when the authoring object changes after compilation', () => {
    const { intro, authored, render } = lesson();
    authored.focus[0].text = 'A later response must not replace an accepted observation.';
    authored.focus[0].exampleIndex = 0;
    expect(
      render(intro, [intro.examples[0], { ...intro.examples[1], target: 'Ils prennent le bus.' }])
    ).toMatchObject({ focus: ['„Ils prennent le bus.“: Le sujet est au pluriel.'] });
  });

  it.each(['about', 'focus', 'tips', 'examples'] as const)(
    'rejects a candidate whose %s no longer matches its compilation evidence',
    (field) => {
      const { intro, render } = lesson();
      const altered = structuredClone(intro);
      if (field === 'about') altered.about = 'Different overview';
      else if (field === 'examples') altered.examples[0].target = 'Different example';
      else altered[field][0] = 'Different observation';
      expect(render(altered)).toBeNull();
    }
  );

  it('keeps accepted overview wording when the target remains unchanged', () => {
    const { intro, render } = lesson();
    const examples = intro.examples.map((example) => ({ ...example, meaning: 'A revised gloss.' }));
    expect(render(intro, examples)).toEqual({
      about: intro.about,
      focus: intro.focus,
      tips: intro.tips,
    });
  });

  it('rejects missing examples instead of guessing a replacement binding', () => {
    const { intro, render } = lesson();
    expect(render(intro, [intro.examples[0]])).toBeNull();
  });

  it('rejects an observation body that cannot reproduce its original rendered text', () => {
    const { intro, bindings, quote } = lesson();
    const altered = {
      ...bindings,
      focus: [{ ...bindings.focus[0], body: 'An unreviewed observation.' }],
    };
    expect(
      renderBoundIntroRepair(altered, intro, intro.examples, () => intro.about, quote)
    ).toBeNull();
  });
});
