import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ClassShell } from '@/components/learn/ClassShell';
import { incompleteClass, recoverableClass } from './class-shell/fixtures';
import { ClassPreludeContext } from '@/components/learn/lesson/ClassPreludeContext';
import { classPresentationIssues } from '@/components/learn/classTypes';
import { createSkillRequirements } from '@sotto/shared';
import { teaching } from './lesson/teaching-fixture';
import type { ReactNode } from 'react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('@/components/learn/lesson/ClassTeachingPrelude', () => ({
  ClassTeachingPrelude: ({ children }: { children: ReactNode }) => children,
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

it('requires reference audio for read-aloud prompts but not communicative tasks', () => {
  const cls = incompleteClass();
  cls.skillRequirements = createSkillRequirements({
    scope: 'CLASS',
    nativeLang: 'en',
    targetLang: 'es',
    level: 'A1',
    ttsProvider: 'local',
    sttProvider: 'local',
  });
  const speaking = cls.sections.find((entry) => entry.skill === 'SPEAKING')!;
  speaking.prompts = [
    {
      id: 'one',
      order: 1,
      taskMode: 'COMMUNICATIVE',
      targetPhrase: 'Ask for tea',
      translation: 'Ask for tea',
    },
    {
      id: 'two',
      order: 2,
      taskMode: 'READ_ALOUD',
      targetPhrase: 'Hola',
      translation: 'Hello',
      referenceTtsUrl: '/audio',
    },
  ];
  expect(classPresentationIssues(cls)).not.toContain('Speaking reference audio is incomplete.');
  speaking.prompts[1].referenceTtsUrl = null;
  expect(classPresentationIssues(cls)).toContain('Speaking reference audio is incomplete.');
});

function answerReading(correct: number) {
  for (let index = 0; index < 5; index += 1) {
    fireEvent.click(
      within(screen.getByRole('region', { name: `Question ${index + 1}` })).getByRole('button', {
        name: index < correct ? 'Option 1: A' : 'Option 2: B',
      })
    );
  }
}

describe('ClassShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps a failed assessment result visible while retry is unavailable', async () => {
    const cls = recoverableClass('failed-assessment-retry');
    const receipt = {
      source: 'ASSESSMENT' as const,
      passed: false,
      overallScore: 0.4,
      passedSections: 0,
      totalSections: 1,
      sections: [
        { id: 'assessment-section', skill: 'GRAMMAR' as const, score: 0.4, passed: false },
      ],
    };
    cls.status = 'FAILED';
    cls.submitted = true;
    cls.submission = { passed: false, overallScore: 0.4, receipt };
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/users/me') return jsonResponse({ id: 'owner' });
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} />);
    expect(
      await screen.findByText('Your result is saved. Assessment retry is not available yet.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Retry the missed sections/ })
    ).not.toBeInTheDocument();
  });

  it('clears an exactly replayed assessment draft when a completed class is reopened', async () => {
    const cls = recoverableClass('completed-assessment-recovery');
    const receipt = {
      source: 'ASSESSMENT' as const,
      passed: true,
      overallScore: 1,
      passedSections: 1,
      totalSections: 1,
      sections: [{ id: 'assessment-section', skill: 'GRAMMAR' as const, score: 1, passed: true }],
    };
    cls.status = 'PASSED';
    cls.submitted = true;
    cls.submission = { passed: true, overallScore: 1, receipt };
    const key = `assessment:${JSON.stringify(['owner', cls.id, 1, 'assessment', 'a'.repeat(64)])}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        choices: { q: 0 },
        drafts: {},
        pending: [{ itemId: 'q', selectedIndex: 0 }],
      })
    );
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/users/me') return jsonResponse({ id: 'owner' });
      if (url.endsWith('/assessment/assessment') && init?.method === 'POST')
        return jsonResponse(receipt);
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} />);
    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  });

  it('saves first-lesson practice before opening the independent assessment', async () => {
    const cls = recoverableClass('beginner-assessment-handoff');
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    const prelude = {
      kind: 'BASE' as const,
      nativeLang: 'en',
      targetLang: 'de',
      receiptId: '00000000-0000-4000-a000-000000000001',
      acknowledged: true,
      teaching: {
        version: teaching.version,
        title: teaching.title,
        explanation: teaching.explanation,
        workedExamples: teaching.workedExamples,
        commonMistake: teaching.commonMistake,
      },
    };
    const events: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/users/me') return jsonResponse({ id: 'owner' });
      if (url.endsWith('/focus-snapshot'))
        return jsonResponse({
          prelude,
          progress: {
            classId: cls.id,
            status: 'AVAILABLE',
            attempt: 1,
            progressRevision: 10,
            taskMaterialRevision: cls.taskMaterialRevision,
          },
        });
      if (url.endsWith('/assessment/status')) {
        events.push('assessment');
        return jsonResponse({ status: 'PRACTICE_REQUIRED', classAttempt: 1 });
      }
      if (url.endsWith('/submit')) throw new Error('Legacy submission must not be used');
      if (init?.method === 'PATCH') {
        events.push('save');
        return jsonResponse({ progressRevision: 11 });
      }
      return jsonResponse(cls);
    });
    render(
      <ClassPreludeContext.Provider value={prelude}>
        <ClassShell classId={cls.id} initialSectionId={reading.id} />
      </ClassPreludeContext.Provider>
    );
    await screen.findByRole('heading', { name: 'Reading practice' });
    answerReading(5);
    fireEvent.click(screen.getByRole('button', { name: 'Continue · Listening' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue · Speaking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue · Writing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish class' }));
    expect(
      await screen.findByText('Finish the practice exercises before starting the assessment.')
    ).toBeInTheDocument();
    expect(events).toContain('save');
    expect(events.indexOf('save')).toBeLessThan(events.indexOf('assessment'));
  });

  it('keeps owned previous speaking work available on the class overview', async () => {
    const cls = recoverableClass('class-speaking-history');
    cls.speakingHistory = [
      {
        sectionId: 'old',
        attempt: 1,
        prompts: [
          {
            id: 'old-prompt',
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
                rubricScores: null,
                phonemeScores: null,
                feedback: 'Clear.',
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        ],
      },
    ];
    global.fetch = vi.fn(async () => jsonResponse(cls));
    render(<ClassShell classId={cls.id} />);
    fireEvent.click(await screen.findByText('Previous speaking work'));
    expect(screen.getByText('Transcript: Hallo Mia')).toBeVisible();
    expect(screen.getByText('Feedback: Clear.')).toBeVisible();
  });

  it('restores the saved assessment result rather than formative section scores', async () => {
    const cls = incompleteClass();
    cls.status = 'PASSED';
    cls.submitted = true;
    cls.submission = {
      passed: true,
      overallScore: 0.9,
      receipt: {
        source: 'ASSESSMENT',
        passed: true,
        overallScore: 0.9,
        passedSections: 1,
        totalSections: 1,
        sections: [{ id: 'assessment-reading', skill: 'READING', score: 0.9, passed: true }],
      },
    };
    global.fetch = vi.fn(async () => jsonResponse(cls));
    render(<ClassShell classId={cls.id} />);
    expect(await screen.findByRole('img', { name: 'Score 90 percent' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Writing practice' })).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Score 0 percent' })).toBeNull();
  });

  it('keeps unverified answers separate until the learner retains a copy and continues', async () => {
    const cls = recoverableClass('class-unverified-copy');
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    const endpoint = `/api/v1/classes/${cls.id}`;
    sessionStorage.setItem(
      `learning:${endpoint}/1`,
      JSON.stringify({
        revision: 10,
        pending: { answers: { 'reading-0': 1 }, writingDrafts: { 'writing-1': 'Old draft' } },
      })
    );
    const writes: unknown[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        writes.push(JSON.parse(String(init.body)));
        return jsonResponse({ progressRevision: 11 });
      }
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
    const recovery = await screen.findByRole('region', { name: 'Retained class work' });
    expect(within(recovery).getByText('Old draft')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Reading practice' })).toBeNull();
    fireEvent.click(within(recovery).getByRole('button', { name: 'Continue with current class' }));
    fireEvent.click(within(recovery).getByRole('button', { name: 'Keep copy and continue' }));
    await screen.findByRole('heading', { name: 'Reading practice' });
    expect(
      within(screen.getByRole('region', { name: 'Question 1' })).getByRole('button', {
        name: 'Option 2: B',
      })
    ).toBeEnabled();
    expect(screen.getByText('Old draft')).toBeVisible();
    expect(writes).toEqual([]);
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Question 1' })).getByRole('button', {
        name: 'Option 2: B',
      })
    );
    await waitFor(() =>
      expect(writes).toEqual([
        expect.objectContaining({
          answers: { 'reading-0': 1 },
          expectedAttempt: 1,
          taskMaterialRevision: 'a'.repeat(64),
        }),
      ])
    );
  });

  it('shows revision-bound directions next to their exercise and clears them when the source changes', async () => {
    const cls = recoverableClass('direction-class');
    cls.teaching = teaching;
    cls.prerequisiteSourceHash = 'a'.repeat(64);
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    let sourceHash = cls.prerequisiteSourceHash;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/prerequisite'))
        return jsonResponse({
          status: 'READY',
          receiptId: '00000000-0000-4000-a000-000000000001',
          acknowledged: true,
          request: { sourceHash, snapshotHash: 'b'.repeat(64) },
          nativeLang: 'es',
          targetLang: 'ru',
          content: {
            title: 'Antes de practicar',
            explanation: 'Aprende la estructura.',
            examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Una palabra.' }],
            directions: {
              guided: 'Pide la bebida con cortesía.',
              tasks: reading.questions.map((question) => ({
                sectionId: reading.id,
                taskId: question.id,
                kind: 'question',
                instruction: `Lee y responde ${question.order}.`,
              })),
            },
          },
        });
      if (init?.method === 'PATCH') return jsonResponse({ progressRevision: 11 });
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
    const first = await screen.findByRole('region', { name: 'Question 1' });
    const instruction = await within(first).findByText('Lee y responde 1.');
    expect(instruction).toHaveAttribute('lang', 'es');
    expect(first).toHaveAccessibleDescription('Lee y responde 1.');
    expect(screen.getByText('Pide la bebida con cortesía.')).toBeVisible();
    fireEvent.click(within(first).getByRole('button', { name: 'Option 1: A' }));
    sourceHash = 'c'.repeat(64);
    fireEvent.focus(window);
    await waitFor(() =>
      expect(within(first).queryByText('Lee y responde 1.')).not.toBeInTheDocument()
    );
    expect(within(first).getByRole('button', { name: 'Option 1: A' })).toBeDisabled();
  });

  it('identifies the class and current section, returns to its overview and retains an answer', async () => {
    const cls = recoverableClass('navigation-class');
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    const writes: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({ progressRevision: 11 });
      }
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
    await screen.findByRole('heading', { name: 'Reading practice' });
    const header = screen.getByRole('banner', { name: 'Class header' });
    expect(within(header).getByRole('link', { name: 'Sotto home' })).toHaveAttribute(
      'href',
      '/learn'
    );
    expect(within(header).getByRole('link', { name: 'Back to Learn' })).toHaveAttribute(
      'href',
      '/learn'
    );
    expect(within(header).getByText('Class 15 · B1')).toBeVisible();
    expect(within(header).getByText(cls.lesson.title)).toBeVisible();
    expect(within(header).getByText('Reading')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Question 1' })).getByRole('button', {
        name: 'Option 1: A',
      })
    );
    await waitFor(() =>
      expect(writes).toEqual([
        expect.objectContaining({
          expectedRevision: 10,
          answers: expect.objectContaining({ [reading.questions[0].id]: 0 }),
        }),
      ])
    );
    fireEvent.click(within(header).getByRole('button', { name: 'Lesson overview' }));
    await screen.findByRole('heading', { name: cls.lesson.title });
    expect(within(header).getByText('Lesson overview')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Resume the class' }));
    await screen.findByRole('heading', { name: 'Reading practice' });
    expect(
      within(screen.getByRole('region', { name: 'Question 1' })).getByRole('button', {
        name: 'Option 1: A',
      })
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Check saved progress' })).not.toBeInTheDocument();
  });

  it('keeps a way home while loading and when the class cannot be loaded', async () => {
    const response = Promise.withResolvers<Response>();
    global.fetch = vi.fn(() => response.promise);
    render(<ClassShell classId="missing-class" />);
    expect(screen.getByRole('status', { name: 'Loading class' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Learn' })).toHaveAttribute('href', '/learn');
    response.resolve(jsonResponse({}, 404));
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Sotto home' })).toHaveAttribute('href', '/learn');
    expect(screen.getByRole('link', { name: 'Back to Learn' })).toBeVisible();
  });

  it('keeps teaching open on a section deep link and preserves an answer when returning to notes', async () => {
    const cls = recoverableClass('teaching-deep-link');
    cls.teaching = teaching;
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    const writes: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({ progressRevision: 11 });
      }
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
    await screen.findByRole('heading', { name: 'Reading practice' });
    const notes = screen.getByText('Lesson notes').closest('details')!;
    expect(notes).toHaveAttribute('open');
    expect(screen.getByText(teaching.explanation)).toBeVisible();
    const option = within(screen.getByRole('region', { name: 'Question 1' })).getByRole('button', {
      name: 'Option 1: A',
    });
    expect(notes.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByText('Lesson notes'));
    expect(screen.getByText(teaching.explanation)).not.toBeVisible();
    fireEvent.click(option);
    await waitFor(() => expect(option).toBeDisabled());
    fireEvent.click(screen.getByText('Lesson notes'));
    expect(screen.getByText(teaching.explanation)).toBeVisible();
    expect(option).toBeDisabled();
    expect(
      within(screen.getByRole('region', { name: 'Question 2' })).getByRole('button', {
        name: 'Option 1: A',
      })
    ).toBeEnabled();
    await waitFor(() =>
      expect(writes).toEqual([
        expect.objectContaining({
          answers: expect.objectContaining({
            [reading.questions[0].id]: 0,
          }),
        }),
      ])
    );
  });

  it('keeps the current question and saved answer when language help is reopened', async () => {
    const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
    try {
      const cls = recoverableClass('help-preserves-progress');
      const revision = 'c'.repeat(64);
      cls.teaching = teaching;
      cls.lessonHelpRevision = revision;
      const reading = cls.sections.find((item) => item.skill === 'READING')!;
      const help = {
        title: teaching.title,
        explanation: 'Una explicación en español.',
        workedExamples: teaching.workedExamples.map((example) => ({
          prompt: example.prompt,
          meaning: 'Un ejemplo.',
          explanation: 'Una explicación.',
        })),
        correctionExplanation: 'Una corrección.',
        guidedPrompt: 'Describe una visita.',
        guidedHint: 'Piensa en el tiempo.',
      };
      const writes: Record<string, unknown>[] = [];
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/lesson-help'))
          return jsonResponse({
            status: 'READY',
            nativeLang: 'es',
            targetLang: 'de',
            canRetry: false,
            help,
            request: {
              operationId: '00000000-0000-4000-a000-000000000001',
              attempt: 1,
              sourceHash: revision,
              retryOf: null,
            },
          });
        if (init?.method === 'PATCH') {
          writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return jsonResponse({ progressRevision: 11 });
        }
        return jsonResponse(cls);
      });
      render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
      await screen.findByRole('heading', { name: 'Reading practice' });
      const first = within(screen.getByRole('region', { name: 'Question 1' })).getByRole('button', {
        name: 'Option 1: A',
      });
      fireEvent.click(first);
      await waitFor(() => expect(first).toBeDisabled());
      for (let index = 0; index < 2; index += 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Help in your language' }));
        const dialog = await screen.findByRole('dialog', { name: teaching.title });
        expect(await within(dialog).findByText(help.guidedPrompt)).toBeVisible();
        expect(within(dialog).queryByText(teaching.guidedPractice.answer)).not.toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Back to lesson' }));
        expect(first).toBeDisabled();
        expect(screen.getByRole('region', { name: 'Question 2' })).toBeVisible();
      }
      await waitFor(() =>
        expect(writes).toEqual([
          expect.objectContaining({
            answers: expect.objectContaining({ [reading.questions[0]!.id]: 0 }),
          }),
        ])
      );
    } finally {
      if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });

  it.each([
    { classThreshold: 0.6, correct: 3, passed: false },
    { classThreshold: 0.9, correct: 4, passed: true },
  ])(
    'uses the section gate when the class threshold is $classThreshold',
    async ({ classThreshold, correct, passed }) => {
      const cls = recoverableClass(`section-threshold-${classThreshold}`);
      cls.passThreshold = classThreshold;
      const reading = cls.sections.find((item) => item.skill === 'READING')!;
      reading.passThreshold = 0.7;
      cls.sections[0].passThreshold = 0.85;
      cls.learnerAnswers = {
        ...cls.learnerAnswers,
        ...Object.fromEntries(
          reading.questions.map((question, index) => [question.id, index < correct ? 0 : 1])
        ),
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(cls));
      render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
      await screen.findByRole('heading', { name: 'Reading practice' });
      const next = screen.getByRole('button', { name: 'Continue · Listening' });
      if (passed) expect(next).toBeEnabled();
      else expect(next).toBeDisabled();
      const stage = within(document.getElementById('class-active-stage')!);
      if (passed)
        expect(
          stage.queryByRole('button', { name: 'Practise with new questions' })
        ).not.toBeInTheDocument();
      else expect(stage.getByRole('button', { name: 'Practise with new questions' })).toBeEnabled();
      const rail = within(screen.getByRole('complementary', { name: 'Class navigation' }));
      expect(rail.getByRole('button', { name: /Grammar gate 85%/ })).toBeInTheDocument();
      expect(rail.getByRole('button', { name: /Reading gate 70%/ })).toBeInTheDocument();
    }
  );

  it('saves failed answers before preparing a new section and preserves other work through final submission', async () => {
    const initial = recoverableClass('fresh-reading-recovery');
    const oldReading = initial.sections.find((item) => item.skill === 'READING')!;
    const next = structuredClone(initial);
    next.attempt = 2;
    const newReading = next.sections.find((item) => item.skill === 'READING')!;
    newReading.id = 'reading-replacement';
    newReading.attempt = 2;
    newReading.questions = newReading.questions.map((question, index) => ({
      ...question,
      id: `fresh-${index}`,
      question: `Fresh reading question ${index + 1}`,
    }));
    let revision = 10;
    let replacementRequested = false;
    let staleReadReturned = false;
    let submitted: { answers: { questionId: string; selectedIndex: number }[] } | undefined;
    const writes: { method: string; body: Record<string, unknown> }[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (String(input).endsWith('/submit')) {
        submitted = body as typeof submitted;
        return jsonResponse({
          passed: true,
          overallScore: 1,
          passedSections: 5,
          totalSections: 5,
          sections: [],
        });
      }
      if (String(input).endsWith('/generation'))
        return jsonResponse({ operationId: 'demo-retry-operation', status: 'COMPLETED' });
      if (init?.method === 'PATCH') {
        writes.push({ method: 'PATCH', body });
        if (body.expectedRevision !== revision)
          return jsonResponse({ error: 'Stale progress revision' }, 409);
        return jsonResponse({ progressRevision: ++revision });
      }
      if (init?.method === 'POST') {
        writes.push({ method: 'POST', body });
        if (body.expectedRevision !== revision)
          return jsonResponse({ error: 'Retry used unconfirmed answers' }, 409);
        replacementRequested = true;
        next.progressRevision = ++revision;
        return jsonResponse(
          {
            started: true,
            status: 'GENERATING',
            scope: 'section',
            operationId: 'demo-retry-operation',
          },
          202
        );
      }
      if (!replacementRequested) return jsonResponse(initial);
      if (!staleReadReturned) {
        staleReadReturned = true;
        return jsonResponse(initial);
      }
      return jsonResponse(next);
    });
    render(<ClassShell classId={initial.id} initialSectionId={oldReading.id} />);
    await screen.findByRole('heading', { name: 'Reading practice' });
    answerReading(3);
    expect(screen.getByRole('button', { name: 'Continue · Listening' })).toBeDisabled();
    const stage = within(document.getElementById('class-active-stage')!);
    fireEvent.click(stage.getByRole('button', { name: 'Practise with new questions' }));
    expect(stage.getByRole('button', { name: 'Preparing new questions...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lesson overview' })).toBeDisabled();
    await screen.findByText('Fresh reading question 1', {}, { timeout: 6000 });
    const retryWrite = writes.find((write) => write.method === 'POST');
    expect(retryWrite?.body).toEqual({
      scope: 'section',
      sectionId: oldReading.id,
      expectedAttempt: 1,
      expectedRevision: 11,
    });
    expect(writes[0]).toEqual({
      method: 'PATCH',
      body: {
        expectedRevision: 10,
        expectedAttempt: 1,
        taskMaterialRevision: 'a'.repeat(64),
        answers: Object.fromEntries(
          oldReading.questions.map((question, index) => [question.id, index < 3 ? 0 : 1])
        ),
      },
    });
    expect(screen.queryByText(oldReading.questions[0].question)).not.toBeInTheDocument();
    answerReading(5);
    fireEvent.click(screen.getByRole('button', { name: 'Continue · Listening' }));
    expect(screen.getByRole('button', { name: 'Option 1: A' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue · Speaking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue · Writing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish class' }));
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted?.answers).toEqual(
      expect.arrayContaining([
        { questionId: 'q-grammar', selectedIndex: 0 },
        { questionId: 'q-listening', selectedIndex: 0 },
        ...newReading.questions.map((question) => ({ questionId: question.id, selectedIndex: 0 })),
      ])
    );
    expect(
      submitted?.answers.some((answer) =>
        oldReading.questions.some((question) => question.id === answer.questionId)
      )
    ).toBe(false);
  });

  it('retains the failed result and blocks paid replacement when progress cannot be saved', async () => {
    const cls = recoverableClass('failed-progress-recovery');
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    const replacements: unknown[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH')
        return jsonResponse({ error: 'Answers could not be saved' }, 503);
      if (init?.method === 'POST') {
        replacements.push(init.body);
        return jsonResponse({}, 202);
      }
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
    await screen.findByRole('heading', { name: 'Reading practice' });
    answerReading(3);
    fireEvent.click(
      within(document.getElementById('class-active-stage')!).getByRole('button', {
        name: 'Practise with new questions',
      })
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .some((alert) => alert.textContent?.includes('Answers could not be saved'))
      ).toBe(true)
    );
    expect(replacements).toEqual([]);
    expect(screen.getByRole('button', { name: 'Continue · Listening' })).toBeDisabled();
    expect(
      screen.getByRole('progressbar', { name: 'Recall: 60% of gate 70%' })
    ).toBeInTheDocument();
    expect(
      within(document.getElementById('class-active-stage')!).getByRole('button', {
        name: 'Practise with new questions',
      })
    ).toBeEnabled();
  });

  it('stops after failed generation and uses restored revision and attempt for the next request', async () => {
    let cls = recoverableClass('generation-failure-recovery');
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    cls.learnerAnswers = {
      ...cls.learnerAnswers,
      ...Object.fromEntries(
        reading.questions.map((question, index) => [question.id, index < 3 ? 0 : 1])
      ),
    };
    let requests = 0;
    let settlingReads = 0;
    const replacements: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/generation'))
        return jsonResponse({
          operationId: `demo-operation-${requests}`,
          status: requests === 1 ? 'FAILED' : 'COMPLETED',
          detail:
            requests === 1 ? 'New questions failed. Your previous work is retained.' : 'Ready',
        });
      if (init?.method === 'POST') {
        replacements.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        requests += 1;
        cls = structuredClone(cls);
        cls.attempt = requests + 1;
        cls.progressRevision = 10 + requests;
        if (requests === 2) {
          const fresh = cls.sections.find((item) => item.skill === 'READING')!;
          fresh.id = 'second-reading-replacement';
          fresh.attempt = 3;
          fresh.questions = fresh.questions.map((question, index) => ({
            ...question,
            id: `second-fresh-${index}`,
            question: `Second fresh question ${index + 1}`,
          }));
          cls.learnerAnswers = { 'q-grammar': 0, 'q-listening': 0 };
        }
        return jsonResponse(
          { started: true, status: 'GENERATING', operationId: `demo-operation-${requests}` },
          202
        );
      }
      if (requests === 1 && settlingReads++ < 2) {
        const staged = structuredClone(cls);
        staged.status = 'GENERATING';
        const stagedReading = staged.sections.find((item) => item.skill === 'READING')!;
        stagedReading.id = 'uncommitted-reading';
        stagedReading.attempt = 2;
        stagedReading.questions = [
          {
            ...stagedReading.questions[0],
            id: 'uncommitted-question',
            question: 'Uncommitted replacement question',
          },
        ];
        return jsonResponse(staged);
      }
      return jsonResponse(cls);
    });
    render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
    const stage = within(
      await screen
        .findByRole('heading', { name: 'Reading practice' })
        .then((heading) => heading.closest('#class-active-stage')! as HTMLElement)
    );
    fireEvent.click(stage.getByRole('button', { name: 'Practise with new questions' }));
    await waitFor(() => expect(settlingReads).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    expect(screen.queryByText('Uncommitted replacement question')).not.toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Recall: 60% of gate 70%' })
    ).toBeInTheDocument();
    expect(stage.getByRole('button', { name: 'Preparing new questions...' })).toBeDisabled();
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      'New questions failed. Your previous work is retained.'
    );
    expect(screen.getByRole('button', { name: 'Continue · Listening' })).toBeDisabled();
    expect(
      screen.getByRole('progressbar', { name: 'Recall: 60% of gate 70%' })
    ).toBeInTheDocument();
    fireEvent.click(stage.getByRole('button', { name: 'Practise with new questions' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await screen.findByText('Second fresh question 1', {}, { timeout: 4000 });
    expect(replacements).toEqual([
      { scope: 'section', sectionId: reading.id, expectedAttempt: 1, expectedRevision: 10 },
      { scope: 'section', sectionId: reading.id, expectedAttempt: 2, expectedRevision: 11 },
    ]);
  });

  it('does not regenerate an incomplete non-generating class during resume', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(incompleteClass()));

    render(<ClassShell classId="class-15" />);

    expect(
      await screen.findByText(/This class is missing required presentation material/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate class/i })).toHaveAttribute(
      'aria-busy',
      'false'
    );
    expect(screen.getByRole('button', { name: /regenerate class/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /back to learn/i })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/v1/classes/class-15?background=1',
      expect.objectContaining({ method: 'POST' })
    );

    fireEvent.click(screen.getByRole('button', { name: /back to learn/i }));
    expect(mockPush).toHaveBeenCalledWith('/learn');
  });

  it.each(['UNRESOLVED', 'REPLACED'])(
    'retains the original quiz with staged questions when preparation is %s',
    async (status) => {
      const cls = recoverableClass(`unresolved-generation-recovery-${status}`);
      const reading = cls.sections.find((item) => item.skill === 'READING')!;
      cls.learnerAnswers = {
        ...cls.learnerAnswers,
        ...Object.fromEntries(
          reading.questions.map((question, index) => [question.id, index < 3 ? 0 : 1])
        ),
      };
      const staged = structuredClone(cls);
      staged.status = 'GENERATING';
      staged.attempt = 2;
      staged.progressRevision = 11;
      const stagedReading = staged.sections.find((item) => item.skill === 'READING')!;
      stagedReading.id = 'unresolved-staged-reading';
      stagedReading.attempt = 2;
      stagedReading.questions = [
        {
          ...reading.questions[0],
          id: 'unresolved-staged-question',
          question: 'Unresolved staged replacement',
        },
      ];
      let accepted = false;
      global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/generation'))
          return jsonResponse({
            operationId: status === 'UNRESOLVED' ? 'unresolved-operation' : 'another-operation',
            status,
            detail: 'Preparation needs recovery before another attempt.',
          });
        if (init?.method === 'POST') {
          accepted = true;
          return jsonResponse({ operationId: 'unresolved-operation', status: 'GENERATING' }, 202);
        }
        return jsonResponse(accepted ? staged : cls);
      });
      render(<ClassShell classId={cls.id} initialSectionId={reading.id} />);
      await screen.findByRole('heading', { name: 'Reading practice' });
      fireEvent.click(
        within(document.getElementById('class-active-stage')!).getByRole('button', {
          name: 'Practise with new questions',
        })
      );
      expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
        status === 'UNRESOLVED'
          ? 'Preparation needs recovery before another attempt.'
          : 'This preparation changed.'
      );
      expect(screen.queryByText('Unresolved staged replacement')).not.toBeInTheDocument();
      expect(
        screen.getByRole('progressbar', { name: 'Recall: 60% of gate 70%' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Continue · Listening' })).toBeDisabled();
    }
  );

  it('surfaces failed listening audio details', async () => {
    const cls = incompleteClass();
    const listening = cls.sections.find((item) => item.skill === 'LISTENING');
    if (listening?.episode) {
      listening.episode.status = 'FAILED';
      listening.episode.failureReason = 'Audio generation failed. Please try again.';
      listening.episode.technicalError =
        'R2 storage not configured - set R2_* environment variables';
    }
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(cls));

    render(<ClassShell classId="class-15" />);

    expect(await screen.findByText(/Listening section audio failed/i)).toHaveTextContent(
      /Audio generation failed/i
    );
  });
});
