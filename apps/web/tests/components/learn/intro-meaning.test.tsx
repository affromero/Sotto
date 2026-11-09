import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassHub } from '@/components/learn/ClassHub';
import WorksheetPage from '@/app/classes/[classId]/worksheet/page';
import type { ClassIntroData, ClassSection } from '@/components/learn/classTypes';
import type { ClassTeaching } from '@sotto/shared';
import { teaching } from './lesson/teaching-fixture';

const boundary = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { id: 'learner' } }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { courseClass: { findFirst: boundary.findFirst } } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not found');
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    teaching?: ClassTeaching;
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
      teaching={overrides.teaching}
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
  it('shows prior quiz choices and grades without editable controls', () => {
    render(
      <ClassHub
        classId="class-1"
        courseId="course-1"
        lesson={{ title: 'Grammar', level: 'A1', objective: 'Choose.' }}
        intro={classIntro}
        order={1}
        sections={[]}
        scores={{}}
        started={false}
        onBegin={vi.fn()}
        onRegenerate={vi.fn()}
        quizHistory={[
          {
            sectionId: 'old',
            skill: 'GRAMMAR',
            attempt: 1,
            questions: [
              {
                id: 'q',
                order: 1,
                question: 'Choose a greeting',
                passageText: null,
                options: ['Hola', 'Adiós'],
                savedChoice: 0,
                submissions: [
                  { attempt: 1, submittedAt: null, selectedIndex: 1, isCorrect: false },
                  { attempt: 2, submittedAt: null, selectedIndex: null, isCorrect: true },
                ],
              },
            ],
          },
        ]}
        orphanQuizAnswers={[
          { sectionId: null, questionId: 'missing', savedChoice: 4, submissions: [] },
        ]}
        quizHistoryUnreadable
        quizSubmissionReceipts={[
          {
            attempt: 3,
            submittedAt: null,
            passed: false,
            overallScore: 0.4,
            answersUnavailable: true,
            passedSections: 1,
            totalSections: null,
            sections: [
              { id: 'speaking', skill: 'SPEAKING', score: 0.8, passed: true },
              { id: null, skill: 'READING', score: 0.7, passed: null },
            ],
            summaryIncomplete: true,
          },
        ]}
      />
    );
    fireEvent.click(screen.getByText('Previous quiz work'));
    expect(screen.getByText('Choose a greeting')).toBeVisible();
    expect(screen.getByText('Saved choice: 1. Hola')).toBeVisible();
    expect(screen.getByText('2. Adiós · Incorrect')).toBeVisible();
    expect(screen.getByText('Choice unavailable · Correct')).toBeVisible();
    expect(screen.getByText('Some individual answers are unavailable.')).toBeVisible();
    expect(screen.getByText('Speaking · Score: 80% · Passed')).toBeVisible();
    expect(screen.getByText('Reading · Score: 70% · Outcome unavailable')).toBeVisible();
    expect(screen.getByText('Recorded: 1 of ? skills passed')).toBeVisible();
    expect(screen.getByText('Saved choice: Choice index 4 (text unavailable)')).toBeVisible();
    expect(screen.getByText('Some previous quiz records could not be displayed.')).toBeVisible();
    const history = screen.getByText('Previous quiz work').parentElement!;
    expect(within(history).queryByRole('button')).toBeNull();
    expect(within(history).queryByRole('radio')).toBeNull();
  });
  it('shows previous speaking attempts without editing or grading controls', () => {
    render(
      <ClassHub
        classId="class-1"
        courseId="course-1"
        lesson={{ title: 'Speaking', level: 'A1', objective: 'Greet someone' }}
        intro={classIntro}
        order={1}
        sections={[]}
        scores={{}}
        started={false}
        onBegin={vi.fn()}
        onRegenerate={vi.fn()}
        speakingHistory={[
          {
            sectionId: 'old',
            attempt: 1,
            prompts: [
              {
                id: 'prompt',
                order: 1,
                targetPhrase: 'Hallo',
                translation: 'Hello',
                recordings: [
                  {
                    id: 'recording',
                    attempt: 1,
                    attemptMatches: true,
                    status: 'SCORED',
                    transcript: 'Hallo Mia',
                    overallScore: 0.8,
                    rubricScores: { accuracy: 0.8, broken: 'legacy' },
                    phonemeScores: [
                      { op: 'substitute', expected: 'r', actual: 'l' },
                      { bad: true },
                    ],
                    feedback: 'Clear greeting',
                    createdAt: '2026-01-01T00:00:00Z',
                  },
                ],
              },
            ],
          },
        ]}
        speakingHistoryUnlinked={[
          {
            id: 'unlinked',
            attempt: 1,
            status: 'PENDING',
            transcript: 'Saved speech',
            overallScore: null,
            rubricScores: null,
            phonemeScores: null,
            feedback: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ]}
      />
    );
    fireEvent.click(screen.getByText('Previous speaking work'));
    expect(screen.getByText('Transcript: Hallo Mia')).toBeVisible();
    expect(screen.getByLabelText('Play saved recording')).toHaveAttribute(
      'src',
      '/api/v1/classes/class-1/speaking/prompt/recordings/recording/audio'
    );
    fireEvent.error(screen.getByLabelText('Play saved recording'));
    expect(
      screen.getByText('Recording unavailable. Your saved feedback is still shown below.')
    ).toBeVisible();
    fireEvent.canPlay(screen.getByLabelText('Play saved recording'));
    expect(
      screen.queryByText('Recording unavailable. Your saved feedback is still shown below.')
    ).toBeNull();
    expect(screen.getByText('Feedback: Clear greeting')).toBeVisible();
    expect(screen.getByText('accuracy: 80%')).toBeVisible();
    expect(screen.getByText('substitute: r → l')).toBeVisible();
    expect(screen.getByText('Some speaking feedback could not be displayed.')).toBeVisible();
    expect(screen.getByText('Recording without its original task')).toBeVisible();
    expect(screen.getByText('Transcript: Saved speech')).toBeVisible();
    const history = screen.getByText('Previous speaking work').parentElement!;
    expect(within(history).queryByRole('button')).toBeNull();
    expect(within(history).queryByRole('textbox')).toBeNull();
  });

  it('shows previous writing and recovered drafts without editing or grading controls', () => {
    render(
      <ClassHub
        classId="class-1"
        courseId="course-1"
        lesson={{ title: 'Writing', level: 'A1', objective: 'Greet someone' }}
        intro={classIntro}
        order={1}
        sections={[]}
        scores={{}}
        started={false}
        onBegin={vi.fn()}
        onRegenerate={vi.fn()}
        writingHistory={[
          {
            sectionId: 'old-section',
            attempt: 2,
            prompts: [
              {
                id: 'old-prompt',
                order: 1,
                task: 'Write a greeting.',
                savedDraft: 'New draft',
                responses: [
                  {
                    id: 'response',
                    attempt: 2,
                    attemptMatches: true,
                    text: 'Hallo',
                    overallScore: 0.8,
                    corrections: [{ old: 'Hallo', new: 'Hallo!', why: 'Add punctuation.' }],
                    feedback: 'Clear greeting.',
                    createdAt: '2026-01-01T00:00:00.000Z',
                  },
                ],
              },
            ],
          },
        ]}
        orphanWritingDrafts={[{ id: 'orphan', text: 'Another saved draft' }]}
      />
    );
    fireEvent.click(screen.getByText('Previous writing'));
    expect(screen.getByText('Write a greeting.')).toBeVisible();
    expect(screen.getByText('New draft')).toBeVisible();
    expect(screen.getByText('Hallo')).toBeVisible();
    expect(screen.getByText('Clear greeting.')).toBeVisible();
    expect(screen.getByText('Hallo → Hallo!: Add punctuation.')).toBeVisible();
    expect(screen.getByText('Another saved draft')).toBeVisible();
    const history = screen.getByText('Previous writing').parentElement!;
    expect(within(history).queryByRole('textbox')).toBeNull();
    expect(within(history).queryByRole('button')).toBeNull();
  });

  it('offers prerequisite teaching for an A1 class with a later curriculum order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          status: 'AVAILABLE',
          request: { sourceHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64) },
          nativeLang: 'es',
          targetLang: 'ru',
        })
      )
    );
    render(
      <ClassHub
        classId="class-1"
        courseId="course-1"
        lesson={{ title: 'Ruso', level: 'A1', objective: 'Pedir.' }}
        intro={classIntro}
        teaching={teaching}
        prerequisiteSourceHash={'a'.repeat(64)}
        order={9}
        sections={[]}
        scores={{}}
        started={false}
        onBegin={vi.fn()}
        onRegenerate={vi.fn()}
      />
    );
    expect(await screen.findByRole('button', { name: 'Explain the basics' })).toBeVisible();
  });
  it('teaches through worked examples before beginning and reveals guided answers only on request', () => {
    const { onBegin } = renderClass({ teaching });
    expect(screen.getByRole('button', { name: 'Help in your language' })).toBeVisible();
    const lesson = screen.getByRole('heading', { name: teaching.title });
    expect(lesson).toBeVisible();
    expect(screen.getByText(teaching.explanation)).toBeVisible();
    const examples = within(screen.getByRole('region', { name: 'Worked examples' }));
    for (const example of teaching.workedExamples) {
      expect(examples.getByText(example.prompt)).toBeVisible();
      expect(examples.getByText(example.answer)).toBeVisible();
      expect(examples.getByText(example.explanation)).toBeVisible();
    }
    const mistake = within(screen.getByRole('region', { name: 'Common mistake' }));
    expect(mistake.getByText(teaching.commonMistake.incorrect)).toBeVisible();
    expect(mistake.getByText(teaching.commonMistake.correction)).toBeVisible();
    expect(screen.getByText(teaching.guidedPractice.prompt)).toBeVisible();
    expect(screen.getByText(teaching.guidedPractice.answer)).not.toBeVisible();
    fireEvent.click(screen.getByText('Show the worked answer'));
    expect(screen.getByText(teaching.guidedPractice.answer)).toBeVisible();
    expect(screen.getByText(teaching.guidedPractice.explanation)).toBeVisible();
    const begin = screen.getByRole('button', { name: 'Begin the class' });
    expect(lesson.compareDocumentPosition(begin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(begin);
    expect(onBegin).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Class summary'));
    expect(screen.getByText(classIntro.purpose)).toBeVisible();
  });

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
