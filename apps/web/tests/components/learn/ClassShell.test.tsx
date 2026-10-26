import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ClassShell } from '@/components/learn/ClassShell';
import type { ClassData, ClassSection } from '@/components/learn/classTypes';
import { teaching } from './lesson/teaching-fixture';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

function section(skill: string, overrides: Partial<ClassSection> = {}): ClassSection {
  return {
    id: `section-${skill.toLowerCase()}`,
    skill,
    status: 'READY',
    attempt: 1,
    score: null,
    passed: null,
    episode: null,
    questions: [],
    prompts: [],
    writingPrompts: [],
    ...overrides,
  };
}

function incompleteClass(): ClassData {
  return {
    id: 'class-15',
    courseId: 'course-1',
    status: 'AVAILABLE',
    order: 15,
    passThreshold: 0.7,
    sourceUrl: null,
    sourceTitle: null,
    lesson: {
      title: 'A tricky class',
      level: 'B1',
      objective: 'Practice the target structure.',
    },
    intro: {
      purpose: 'Practice the target structure.',
      about: 'A compact class.',
      focus: ['Use the target phrase.'],
      examples: [],
      tips: [],
    },
    vocabulary: [],
    submitted: false,
    submission: null,
    sections: [
      section('GRAMMAR', {
        questions: [
          {
            id: 'q-grammar',
            order: 1,
            question: 'Pick one.',
            options: ['A', 'B'],
          },
        ],
      }),
      section('READING', {
        questions: [
          {
            id: 'q-reading',
            order: 1,
            question: 'What happened?',
            options: ['A', 'B'],
            passageText: 'A readable passage.',
          },
        ],
      }),
      section('LISTENING', {
        episode: {
          id: 'episode-1',
          audioUrl: null,
          status: 'READY',
          title: 'Listening scene',
          references: [],
        },
        questions: [
          {
            id: 'q-listening',
            order: 1,
            question: 'What did you hear?',
            options: ['A', 'B'],
          },
        ],
      }),
      section('SPEAKING', {
        prompts: [
          {
            id: 'prompt-1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
          },
        ],
      }),
      section('WRITING', {
        writingPrompts: [
          {
            id: 'writing-1',
            order: 1,
            task: 'Write one sentence.',
            response: null,
          },
        ],
      }),
    ],
  };
}

function recoverableClass(id: string): ClassData {
  const cls = incompleteClass();
  cls.id = id;
  cls.attempt = 1;
  cls.progressRevision = 10;
  cls.learnerAnswers = { 'q-grammar': 0, 'q-listening': 0 };
  for (const item of cls.sections) {
    item.questions = item.questions.map((question) => ({
      ...question,
      correctIndex: 0,
      explanation: 'Read the time expression.',
    }));
    if (item.episode) item.episode.audioUrl = '/demo-listening.mp3';
    if (item.skill === 'READING')
      item.questions = Array.from({ length: 5 }, (_, index) => ({
        id: `reading-${index}`,
        order: index + 1,
        question: `What happened on day ${index + 1}?`,
        options: ['A', 'B'],
        correctIndex: 0,
        explanation: 'The passage describes a visit.',
        passageText: 'On Sunday, a student visited a museum.',
      }));
    for (const prompt of item.prompts)
      prompt.latestRecording = {
        id: 'saved-speaking',
        status: 'SCORED',
        overallScore: 1,
      };
    for (const prompt of item.writingPrompts)
      prompt.response = {
        text: 'I visited a museum.',
        overallScore: 1,
        corrections: [],
        feedback: 'Clear sentence.',
      };
  }
  return cls;
}

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

  it('keeps teaching open on a section deep link and preserves an answer when returning to notes', async () => {
    const cls = recoverableClass('teaching-deep-link');
    cls.teaching = teaching;
    const reading = cls.sections.find((item) => item.skill === 'READING')!;
    const writes: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({ revision: 11 });
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
    expect(screen.getByRole('button', { name: /Leave class/ })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: /regenerate class/i })).toBeInTheDocument();
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
