import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassHub } from '@/components/learn/ClassHub';
import WorksheetPage from '@/app/classes/[classId]/worksheet/page';
import type { ClassIntroData, ClassSection } from '@/components/learn/classTypes';

const boundary = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'learner' } }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { courseClass: { findFirst: boundary.findFirst } } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not found');
  },
}));

afterEach(cleanup);

describe('intro example meaning display', () => {
  it.each([true, false])(
    'shows distinct meaning without repeating an identical target (%s)',
    async (identical) => {
      const target = 'Ich habe gestern einen Film gesehen.';
      const meaning = identical ? target : 'I watched a film yesterday.';
      const intro = {
        purpose: 'Erzähle von gestern.',
        about: target,
        focus: ['Das Perfekt beschreibt Vergangenes.'],
        examples: [{ target, meaning, note: 'Sehen verwendet hier haben.' }],
        tips: ['Nenne den Tag.'],
      };
      const lesson = { title: 'Gestern', level: 'A2', objective: 'Erzähle von gestern.' };
      const { unmount } = render(
        <ClassHub
          classId="class-1"
          courseId="course-1"
          lesson={lesson}
          intro={intro}
          order={1}
          sections={[]}
          scores={{}}
          started={false}
          onBegin={vi.fn()}
          onRegenerate={vi.fn()}
        />
      );
      const examples = within(screen.getByRole('region', { name: 'Examples' }));
      expect(examples.getByRole('heading', { name: target, level: 3 })).toBeVisible();
      expect(examples.getByText(intro.examples[0].note)).toBeVisible();
      if (identical) {
        expect(examples.getAllByText(target)).toHaveLength(1);
      } else {
        expect(examples.getByText(meaning)).toBeVisible();
      }
      unmount();

      boundary.findFirst.mockResolvedValue({
        id: 'class-1',
        course: { nativeLang: 'en', targetLang: 'de' },
        lesson: { ...lesson, grammarPoints: ['Perfekt'], targetVocab: [] },
        adaptiveSeed: { intro },
        sourceTitle: null,
        sections: [],
      });
      render(await WorksheetPage({ params: Promise.resolve({ classId: 'class-1' }) }));
      const example = screen.getByRole('heading', { name: target, level: 3 }).closest('article');
      expect(example?.querySelector('p')?.textContent ?? null).toBe(identical ? null : meaning);
      expect(example?.querySelector('small')?.textContent).toBe(intro.examples[0].note);
    }
  );
});

const classIntro: ClassIntroData = {
  purpose: 'Du erzählst, was du gestern gemacht hast.',
  about: 'Ich habe gestern meine Freundin besucht.',
  focus: ['Das Hilfsverb steht vor dem Partizip.'],
  examples: [
    {
      target: 'Ich habe gestern meine Freundin besucht.',
      meaning: 'I visited my friend yesterday.',
      note: 'Habe ist das Hilfsverb. Besucht steht am Satzende.',
    },
    {
      target: 'Ich bin gestern nach Hause gegangen.',
      meaning: 'I went home yesterday.',
      note: 'Gehen bildet das Perfekt mit sein.',
    },
  ],
  tips: ['Achte auf die Reihenfolge.'],
};

function activity(id: string, skill: string): ClassSection {
  return {
    id,
    skill,
    status: 'READY',
    attempt: 1,
    score: null,
    passed: null,
    episode: null,
    questions: [],
    prompts: [],
    writingPrompts: [],
  };
}

function renderClass(
  overrides: {
    intro?: ClassIntroData;
    started?: boolean;
    regenerating?: boolean;
    sections?: ClassSection[];
    scores?: Record<string, number>;
  } = {}
) {
  const onBegin = vi.fn();
  const onRegenerate = vi.fn();
  render(
    <ClassHub
      classId="class-1"
      courseId="course-1"
      lesson={{ title: 'Talking About Past Events', level: 'A2', objective: classIntro.purpose }}
      intro={overrides.intro ?? classIntro}
      order={9}
      sections={
        overrides.sections ?? [activity('grammar-1', 'GRAMMAR'), activity('reading-1', 'READING')]
      }
      scores={overrides.scores ?? { 'grammar-1': 80 }}
      started={overrides.started ?? false}
      regenerating={overrides.regenerating ?? false}
      onBegin={onBegin}
      onRegenerate={onRegenerate}
    />
  );
  return { onBegin, onRegenerate };
}

describe('class reading flow', () => {
  it('labels the reading sequence and shows every example note immediately', () => {
    renderClass();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    ).toEqual(['Class goal', 'Key points', 'Examples', 'Remember', 'Practice this class']);
    expect(screen.getByText(classIntro.purpose)).toBeVisible();
    expect(screen.getByText(classIntro.focus[0])).toBeVisible();
    for (const example of classIntro.examples) {
      expect(screen.getByRole('heading', { name: example.target, level: 3 })).toBeVisible();
      expect(screen.getByText(example.meaning)).toBeVisible();
      expect(screen.getByText(example.note)).toBeVisible();
    }
    expect(screen.getAllByText(classIntro.about)).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'About this class' })).not.toBeInTheDocument();
  });

  it('preserves distinct introductory context', () => {
    const about = 'Today you will describe visits and journeys in the past.';
    renderClass({ intro: { ...classIntro, about } });
    expect(
      within(screen.getByRole('region', { name: 'About this class' })).getByText(about)
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: classIntro.examples[0].target })).toBeVisible();
  });

  it('preserves teaching tips alongside unique visual callouts and linked material', () => {
    const callout = 'Movement verbs can use sein.';
    renderClass({
      intro: {
        ...classIntro,
        visuals: {
          timeline: null,
          contrast: null,
          callouts: [
            { label: 'Reminder', text: classIntro.tips[0], tone: 'blue' },
            { label: 'Movement', text: callout, tone: 'teal' },
          ],
          links: [{ label: 'Perfekt reference', url: 'https://example.com/perfekt' }],
        },
      },
    });
    const reminders = within(screen.getByRole('region', { name: 'Remember' }));
    expect(reminders.getAllByText(classIntro.tips[0])).toHaveLength(1);
    expect(reminders.getByText(callout, { exact: false })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Perfekt reference' })).toHaveAttribute(
      'href',
      'https://example.com/perfekt'
    );
  });

  it('keeps optional visual explanations available without hiding example notes', () => {
    renderClass({
      intro: {
        ...classIntro,
        visuals: {
          timeline: { title: 'Yesterday to today', steps: ['Gestern', 'Heute'] },
          contrast: {
            title: 'Auxiliary verbs',
            leftLabel: 'haben',
            leftItems: ['besucht'],
            rightLabel: 'sein',
            rightItems: ['gegangen'],
          },
          callouts: [],
          links: [],
        },
      },
    });
    expect(screen.getByText(classIntro.examples[1].note)).toBeVisible();
    const disclosure = screen.getByText('Visual summary').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    if (!disclosure) throw new Error('Visual explanation disclosure is missing');
    fireEvent.click(screen.getByText('Visual summary'));
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('Yesterday to today')).toBeVisible();
    expect(screen.getByText('Auxiliary verbs')).toBeVisible();
    expect(screen.getByText('Gestern')).toBeVisible();
    expect(screen.getByText('gegangen')).toBeVisible();
  });

  it.each([false, true])('keeps the primary class action and worksheet route (%s)', (started) => {
    const { onBegin, onRegenerate } = renderClass({ started });
    fireEvent.click(
      screen.getByRole('button', { name: started ? 'Resume the class' : 'Begin the class' })
    );
    expect(onBegin).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate class' }));
    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Export / print' })).toHaveAttribute(
      'href',
      '/classes/class-1/worksheet'
    );
    expect(screen.getByRole('progressbar', { name: 'Class activity progress' })).toHaveAttribute(
      'value',
      '1'
    );
  });

  it('counts activities separately when a class repeats a skill and disables regeneration in progress', () => {
    renderClass({
      regenerating: true,
      sections: [activity('grammar-1', 'GRAMMAR'), activity('grammar-2', 'GRAMMAR')],
    });
    expect(
      within(screen.getByRole('list', { name: 'Class activities' })).getAllByRole('listitem')
    ).toHaveLength(2);
    expect(screen.getByText('1 of 2 activities')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Regenerating...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Begin the class' })).toBeEnabled();
  });

  it('shows zero and persisted scores without claiming an activity has never started', () => {
    renderClass({
      scores: { 'grammar-1': 0 },
      sections: [
        activity('grammar-1', 'GRAMMAR'),
        { ...activity('reading-1', 'READING'), score: 0.8, attempt: 2 },
      ],
    });
    const activities = within(screen.getByRole('list', { name: 'Class activities' }));
    expect(activities.getByText('0%')).toBeVisible();
    expect(activities.getByText('80%')).toBeVisible();
    expect(activities.queryByText('Not started')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 activities')).toBeVisible();
  });

  it('formats live percentages and stored score fractions without floating-point noise', () => {
    renderClass({
      scores: { 'grammar-1': 100 / 3 },
      sections: [
        activity('grammar-1', 'GRAMMAR'),
        { ...activity('reading-1', 'READING'), score: 0.5890000000000001 },
      ],
    });
    const activities = within(screen.getByRole('list', { name: 'Class activities' }));
    expect(activities.getByText('33.3%')).toBeVisible();
    expect(activities.getByText('58.9%')).toBeVisible();
  });
});
