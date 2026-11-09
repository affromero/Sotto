import type { Prisma, SkillType } from '@/generated/prisma/client';

type SavedQuestion = {
  id: string;
  order: number;
  question: string;
  passageText: string | null;
  options: Prisma.JsonValue;
};
type SavedSection = {
  id: string;
  skill: SkillType;
  attempt: number;
  withdrawn: boolean;
  questions: SavedQuestion[];
};
type SubmittedAnswer = {
  sectionId: string;
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
};
type Submission = {
  userId: string;
  attempt: number | null;
  submittedAt: Date;
  history: Prisma.JsonValue;
  answers: SubmittedAnswer[];
  passed?: boolean | null;
  overallScore?: number | null;
  receipt?: Prisma.JsonValue;
};
type SubmissionEvent = {
  attempt: number | null;
  submittedAt: string | null;
  selectedIndex: number | null;
  isCorrect: boolean | null;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function index(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function receiptDetails(value: unknown) {
  const result: {
    passedSections: number | null;
    totalSections: number | null;
    sections: Array<{
      id: string | null;
      skill: 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING' | 'WRITING' | null;
      score: number | null;
      passed: boolean | null;
    }>;
    summaryIncomplete: boolean;
  } = { passedSections: null, totalSections: null, sections: [], summaryIncomplete: false };
  if (!object(value)) return { ...result, summaryIncomplete: true };
  if (index(value.passedSections) && value.passedSections >= 0)
    result.passedSections = value.passedSections;
  else result.summaryIncomplete = true;
  if (index(value.totalSections) && value.totalSections >= 0)
    result.totalSections = value.totalSections;
  else result.summaryIncomplete = true;
  if (
    result.passedSections !== null &&
    result.totalSections !== null &&
    result.passedSections > result.totalSections
  )
    result.summaryIncomplete = true;
  if (!Array.isArray(value.sections)) result.summaryIncomplete = true;
  else
    for (const section of value.sections) {
      if (!object(section)) {
        result.summaryIncomplete = true;
        continue;
      }
      const id = typeof section.id === 'string' ? section.id : null;
      const skill =
        section.skill === 'GRAMMAR' ||
        section.skill === 'READING' ||
        section.skill === 'LISTENING' ||
        section.skill === 'SPEAKING' ||
        section.skill === 'WRITING'
          ? section.skill
          : null;
      const score =
        typeof section.score === 'number' && Number.isFinite(section.score) ? section.score : null;
      const passed = typeof section.passed === 'boolean' ? section.passed : null;
      if (
        id === null ||
        skill === null ||
        score === null ||
        passed === null ||
        (score !== null && (score < 0 || score > 1))
      )
        result.summaryIncomplete = true;
      if (id !== null || skill !== null || score !== null || passed !== null)
        result.sections.push({ id, skill, score, passed });
    }
  return result;
}

/** Project owned saved choices and submissions without activating earlier tasks. */
export function classQuizHistory(input: {
  userId: string;
  sections: SavedSection[];
  activeSectionIds: ReadonlySet<string>;
  learnerAnswers: Prisma.JsonValue;
  submission: Submission | null | undefined;
}) {
  const { userId, sections, activeSectionIds, learnerAnswers, submission } = input;
  let unreadable = false;
  const drafts = new Map<string, number>();
  if (learnerAnswers !== null) {
    if (!object(learnerAnswers)) unreadable = true;
    else
      for (const [id, value] of Object.entries(learnerAnswers)) {
        if (index(value)) drafts.set(id, value);
        else unreadable = true;
      }
  }
  const events: Array<{
    sectionId: string | null;
    questionId: string | null;
    event: SubmissionEvent;
  }> = [];
  const quizSubmissionReceipts: Array<{
    attempt: number | null;
    submittedAt: string | null;
    passed: boolean | null;
    overallScore: number | null;
    answersUnavailable: boolean;
    passedSections: number | null;
    totalSections: number | null;
    sections: ReturnType<typeof receiptDetails>['sections'];
    summaryIncomplete: boolean;
  }> = [];
  const append = (value: unknown, attempt: number | null, submittedAt: string | null) => {
    if (!object(value)) {
      unreadable = true;
      return false;
    }
    const selectedIndex = index(value.selectedIndex) ? value.selectedIndex : null;
    const sectionId = typeof value.sectionId === 'string' ? value.sectionId : null;
    const questionId = typeof value.questionId === 'string' ? value.questionId : null;
    const isCorrect = typeof value.isCorrect === 'boolean' ? value.isCorrect : null;
    if (sectionId === null || questionId === null || selectedIndex === null || isCorrect === null)
      unreadable = true;
    events.push({
      sectionId,
      questionId,
      event: {
        attempt,
        submittedAt,
        selectedIndex,
        isCorrect,
      },
    });
    return (
      sectionId !== null && questionId !== null && selectedIndex !== null && isCorrect !== null
    );
  };
  if (submission) {
    if (submission.userId !== userId) unreadable = true;
    else {
      quizSubmissionReceipts.push({
        attempt: submission.attempt,
        submittedAt: submission.submittedAt.toISOString(),
        passed: submission.passed ?? null,
        overallScore: submission.overallScore ?? null,
        answersUnavailable: false,
        ...receiptDetails(submission.receipt),
      });
      if (submission.passed == null || submission.overallScore == null)
        quizSubmissionReceipts[0]!.summaryIncomplete = true;
      if (
        submission.overallScore != null &&
        (!Number.isFinite(submission.overallScore) ||
          submission.overallScore < 0 ||
          submission.overallScore > 1)
      )
        quizSubmissionReceipts[0]!.summaryIncomplete = true;
      if (submission.overallScore != null && !Number.isFinite(submission.overallScore))
        quizSubmissionReceipts[0]!.overallScore = null;
      for (const answer of submission.answers)
        if (!append(answer, submission.attempt, submission.submittedAt.toISOString()))
          quizSubmissionReceipts[0]!.answersUnavailable = true;
      if (submission.history !== null) {
        if (!Array.isArray(submission.history)) unreadable = true;
        else
          for (const entry of submission.history) {
            if (!object(entry)) {
              unreadable = true;
              continue;
            }
            const attempt = index(entry.attempt) && entry.attempt > 0 ? entry.attempt : null;
            const submittedAt = typeof entry.submittedAt === 'string' ? entry.submittedAt : null;
            if (entry.attempt !== null && attempt === null) unreadable = true;
            if (entry.submittedAt !== null && submittedAt === null) unreadable = true;
            const receipt = object(entry.receipt) ? entry.receipt : null;
            const passed = typeof receipt?.passed === 'boolean' ? receipt.passed : null;
            const overallScore =
              typeof receipt?.overallScore === 'number' && Number.isFinite(receipt.overallScore)
                ? receipt.overallScore
                : null;
            const answersUnavailable = !Array.isArray(entry.answers);
            const projected = {
              attempt,
              submittedAt,
              passed,
              overallScore,
              answersUnavailable,
              ...receiptDetails(entry.receipt),
            };
            if (passed === null || overallScore === null || overallScore < 0 || overallScore > 1)
              projected.summaryIncomplete = true;
            quizSubmissionReceipts.push(projected);
            if (answersUnavailable) {
              unreadable = true;
              continue;
            }
            for (const answer of entry.answers as unknown[])
              if (!append(answer, attempt, submittedAt)) projected.answersUnavailable = true;
          }
      }
    }
  }
  const visible = sections.filter(
    (section) =>
      !section.withdrawn &&
      (section.skill === 'GRAMMAR' || section.skill === 'READING' || section.skill === 'LISTENING')
  );
  const eventIndex = new Map<string, Map<string, number[]>>();
  for (const [position, item] of events.entries()) {
    if (item.sectionId === null || item.questionId === null) continue;
    let questions = eventIndex.get(item.sectionId);
    if (!questions) {
      questions = new Map();
      eventIndex.set(item.sectionId, questions);
    }
    const matches = questions.get(item.questionId) ?? [];
    matches.push(position);
    questions.set(item.questionId, matches);
  }
  const resolved = new Set<number>();
  const known = new Set(
    visible.flatMap((section) => section.questions.map((question) => question.id))
  );
  const quizHistory = visible
    .sort((left, right) => right.attempt - left.attempt || left.id.localeCompare(right.id))
    .map((section) => ({
      sectionId: section.id,
      skill: section.skill,
      attempt: section.attempt,
      questions: section.questions.map((question) => {
        const submissions = (eventIndex.get(section.id)?.get(question.id) ?? []).map((position) => {
          resolved.add(position);
          return events[position]!.event;
        });
        const options =
          Array.isArray(question.options) &&
          question.options.every((item) => typeof item === 'string')
            ? (question.options as string[])
            : null;
        return {
          id: question.id,
          order: question.order,
          question: question.question,
          passageText: question.passageText,
          options,
          savedChoice: activeSectionIds.has(section.id) ? null : (drafts.get(question.id) ?? null),
          submissions,
        };
      }),
    }))
    .filter(
      (section) =>
        !activeSectionIds.has(section.sectionId) ||
        section.questions.some((q) => q.submissions.length)
    );
  const orphanQuizAnswers: Array<{
    sectionId: string | null;
    questionId: string | null;
    savedChoice: number | null;
    submissions: SubmissionEvent[];
  }> = [];
  for (const [questionId, savedChoice] of drafts) {
    if (!known.has(questionId))
      orphanQuizAnswers.push({ sectionId: null, questionId, savedChoice, submissions: [] });
  }
  for (const [position, item] of events.entries()) {
    if (!resolved.has(position))
      orphanQuizAnswers.push({
        sectionId: item.sectionId,
        questionId: item.questionId,
        savedChoice: null,
        submissions: [item.event],
      });
  }
  return {
    quizHistory,
    orphanQuizAnswers,
    quizSubmissionReceipts,
    quizHistoryUnreadable: unreadable,
  };
}
