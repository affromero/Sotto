import type { CapturedLearningAi } from '../../../learning-ai';
import type { ListeningContent, ListeningContentParams } from '../../../class-listening-generator';
import { learningCredentialFingerprint } from '../../preparation-selection';
import { learningScriptHash } from '../../../learning/script-hash';
import { SectionQualityError } from '../../section-quality';

type Question = ListeningContent['comprehensionQuestions'][number];
type Script = { turns: ListeningContent['turns']; soundCues: unknown; markdown: string };
export type InitialA1ListeningReceipt = { readonly __initialA1ListeningReceipt: unique symbol };
export type InitialA1ListeningSnapshot = {
  classId: string;
  courseId: string;
  userId: string;
  attempt: number;
  sectionId: string;
  seed: string;
  episodeId: string;
  scriptId: string;
  scriptHash: string;
  turns: ListeningContent['turns'];
  soundCues: unknown;
  markdown: string;
  objective: string;
  questions: Array<Question & { id: string; order: number }>;
};

function project(questions: readonly Question[]) {
  return questions.map(({ question, options, correctIndex, explanation }) => ({
    question,
    options: [...options],
    correctIndex,
    explanation,
  }));
}

function context(p: ListeningContentParams) {
  return JSON.stringify({
    userId: p.userId,
    courseId: p.courseId,
    level: p.level,
    nativeLang: p.nativeLang,
    targetLang: p.targetLang,
    objective: p.objective,
    mustIncludeVocab: p.mustIncludeVocab,
    firstSeenClassId: p.firstSeenClassId,
    note: p.note,
    teaching: p.teaching,
    retry: p.retry,
    sourceContent: p.sourceContent,
    sourceMetadata: p.sourceMetadata,
    sourceUrl: p.sourceUrl,
    ttsProvider: p.ttsProvider,
    deferAudio: p.deferAudio,
    reviewScope: p.reviewScope,
  });
}

/** The listening generator alone retains candidate acceptance authority. */
export function createListeningReviewAuthority() {
  type Snapshot = ReturnType<typeof capture>;
  const accepted = new WeakMap<ListeningContent, { snapshot: Snapshot; scriptId: string }>();
  const bound = new WeakMap<ListeningContent, InitialA1ListeningReceipt>();
  const receipts = new WeakMap<
    InitialA1ListeningReceipt,
    {
      content: ListeningContent;
      params: ListeningContentParams;
      stored: InitialA1ListeningSnapshot;
    }
  >();
  const seeds = new WeakMap<object, { receipt: InitialA1ListeningReceipt; teaching: object }>();
  const failure = () =>
    new SectionQualityError('The initial A1 listening review is no longer valid.');

  function capture(
    script: Script,
    questions: Question[],
    reviewed: readonly unknown[],
    p: ListeningContentParams,
    ai: CapturedLearningAi,
    episodeId: string
  ) {
    const scope = p.reviewScope;
    const execution = p.execution;
    if (
      p.level !== 'A1' ||
      !p.teaching ||
      !scope?.classId ||
      !scope.attempt ||
      !Number.isSafeInteger(scope.attempt) ||
      scope.attempt < 1 ||
      scope.classId !== p.firstSeenClassId ||
      !p.courseId ||
      !episodeId ||
      p.retry ||
      execution.initialA1Class !== true ||
      execution.userId !== p.userId ||
      ai.execution.initialA1Class !== true ||
      ai.execution.userId !== p.userId ||
      ai.execution.authorize !== execution.authorize ||
      ai.execution.signal !== execution.signal ||
      ai.execution.providerRequest !== execution.providerRequest ||
      ai.execution.sourceDocuments !== execution.sourceDocuments ||
      ai.execution.onCleanupError !== execution.onCleanupError ||
      ai.execution.registerAudioEpisode !== execution.registerAudioEpisode ||
      ai.execution.isolatedWorkspace?.markCleanupUnconfirmed !==
        execution.isolatedWorkspace?.markCleanupUnconfirmed
    )
      throw failure();
    execution.signal?.throwIfAborted();
    return {
      script,
      questions,
      reviewed,
      params: p,
      ai,
      episodeId,
      candidate: JSON.stringify({ script, questions: project(questions), reviewed }),
      context: context(p),
      execution,
      aiExecution: ai.execution,
      authorize: execution.authorize,
      signal: execution.signal,
      providerRequest: execution.providerRequest,
      sourceDocuments: execution.sourceDocuments,
      onCleanupError: execution.onCleanupError,
      registerAudioEpisode: execution.registerAudioEpisode,
      markCleanupUnconfirmed: execution.isolatedWorkspace?.markCleanupUnconfirmed,
      selection: JSON.stringify({
        provider: ai.provider,
        model: ai.model,
        endpoint: ai.endpoint,
        isolatedImage: ai.isolatedImage,
        aiCredential: learningCredentialFingerprint(ai.execution.credential),
        credential: learningCredentialFingerprint(execution.credential),
        learningSelection: execution.learningSelection,
        aiSelection: ai.execution.learningSelection,
        workspace: execution.isolatedWorkspace?.directory,
        aiWorkspace: ai.execution.isolatedWorkspace?.directory,
        ttsModel: execution.ttsModel,
      }),
      apiKey: ai.apiKey,
    };
  }

  function check(p: ListeningContentParams, snapshot: Snapshot) {
    const current = capture(
      snapshot.script,
      snapshot.questions,
      snapshot.reviewed,
      p,
      snapshot.ai,
      snapshot.episodeId
    );
    if (
      p !== snapshot.params ||
      current.execution !== snapshot.execution ||
      current.aiExecution !== snapshot.aiExecution ||
      current.authorize !== snapshot.authorize ||
      current.signal !== snapshot.signal ||
      current.providerRequest !== snapshot.providerRequest ||
      current.sourceDocuments !== snapshot.sourceDocuments ||
      current.onCleanupError !== snapshot.onCleanupError ||
      current.registerAudioEpisode !== snapshot.registerAudioEpisode ||
      current.markCleanupUnconfirmed !== snapshot.markCleanupUnconfirmed ||
      current.selection !== snapshot.selection ||
      current.apiKey !== snapshot.apiKey ||
      current.context !== snapshot.context ||
      current.candidate !== snapshot.candidate
    )
      throw failure();
  }

  function accept(
    content: ListeningContent,
    p: ListeningContentParams,
    snapshot: Snapshot,
    scriptId: string
  ) {
    check(p, snapshot);
    if (
      !scriptId ||
      content.episodeId !== snapshot.episodeId ||
      JSON.stringify(content.turns) !== JSON.stringify(snapshot.script.turns) ||
      JSON.stringify(project(content.comprehensionQuestions)) !==
        JSON.stringify(project(snapshot.questions))
    )
      throw failure();
    accepted.set(content, { snapshot, scriptId });
  }

  function require(
    content: ListeningContent,
    p: ListeningContentParams,
    assessed?: readonly Question[]
  ) {
    const record = accepted.get(content);
    if (!record) throw failure();
    check(p, record.snapshot);
    if (
      content.episodeId !== record.snapshot.episodeId ||
      JSON.stringify(content.turns) !== JSON.stringify(record.snapshot.script.turns) ||
      JSON.stringify(project(content.comprehensionQuestions)) !==
        JSON.stringify(project(record.snapshot.questions)) ||
      (assessed &&
        JSON.stringify(project(assessed)) !== JSON.stringify(project(record.snapshot.questions)))
    )
      throw failure();
    return record;
  }

  function verifyIfReviewed(content: ListeningContent) {
    const record = accepted.get(content);
    if (record) require(content, record.snapshot.params);
  }

  function boundIfReviewed(content: ListeningContent) {
    if (!accepted.has(content)) return undefined;
    const receipt = bound.get(content);
    if (!receipt) throw failure();
    return inspect(receipt);
  }

  function bind(
    content: ListeningContent,
    p: ListeningContentParams,
    assessed: readonly Question[],
    sectionId: string,
    seed: string,
    ids: readonly string[]
  ) {
    const record = require(content, p, assessed);
    const scope = p.reviewScope;
    if (
      !scope ||
      !sectionId ||
      !seed ||
      ids.length !== assessed.length ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      throw failure();
    const receipt = Object.freeze({}) as InitialA1ListeningReceipt;
    receipts.set(receipt, {
      content,
      params: p,
      stored: {
        ...scope,
        courseId: p.courseId,
        userId: p.userId,
        sectionId,
        seed,
        episodeId: content.episodeId,
        scriptId: record.scriptId,
        objective: p.objective,
        scriptHash: learningScriptHash(content.turns),
        turns: structuredClone(content.turns),
        soundCues: structuredClone(record.snapshot.script.soundCues),
        markdown: record.snapshot.script.markdown,
        questions: project(assessed).map((question, index) => ({
          ...question,
          id: ids[index]!,
          order: index + 1,
        })),
      },
    });
    bound.set(content, receipt);
    return receipt;
  }

  function inspect(receipt: InitialA1ListeningReceipt) {
    const record = receipts.get(receipt);
    if (!record) throw failure();
    require(record.content, record.params);
    if (
      JSON.stringify(project(record.content.comprehensionQuestions)) !==
        JSON.stringify(project(record.stored.questions)) ||
      learningScriptHash(record.content.turns) !== record.stored.scriptHash
    )
      throw failure();
    return structuredClone(record.stored);
  }

  function sealSeed(
    seed: object,
    teaching: object,
    receipt: InitialA1ListeningReceipt,
    scope: {
      classId: string;
      courseId: string;
      userId: string;
      attempt: number;
      level: string;
      nativeLang: string;
      targetLang: string;
      objective: string;
      mustIncludeVocab: ListeningContentParams['mustIncludeVocab'];
      note?: string;
      sourceContent?: string;
      sourceMetadata?: ListeningContentParams['sourceMetadata'];
      sourceUrl?: string;
      ttsProvider: ListeningContentParams['ttsProvider'];
      deferAudio?: boolean;
    }
  ) {
    const record = receipts.get(receipt);
    const stored = inspect(receipt);
    if (
      !record ||
      record.params.teaching !== teaching ||
      stored.classId !== scope.classId ||
      stored.courseId !== scope.courseId ||
      stored.userId !== scope.userId ||
      stored.attempt !== scope.attempt ||
      record.params.level !== scope.level ||
      record.params.nativeLang !== scope.nativeLang ||
      record.params.targetLang !== scope.targetLang ||
      record.params.objective !== scope.objective ||
      record.params.note !== scope.note ||
      record.params.sourceContent !== scope.sourceContent ||
      record.params.sourceUrl !== scope.sourceUrl ||
      record.params.ttsProvider !== scope.ttsProvider ||
      record.params.deferAudio !== scope.deferAudio ||
      JSON.stringify(record.params.sourceMetadata) !== JSON.stringify(scope.sourceMetadata) ||
      JSON.stringify(record.params.mustIncludeVocab) !== JSON.stringify(scope.mustIncludeVocab)
    )
      throw failure();
    seeds.set(seed, { receipt, teaching });
  }

  function materializeSeed(
    seed: object,
    expected: { classId: string; userId: string; attempt: number }
  ) {
    const record = seeds.get(seed);
    if (!record || (seed as { teaching?: unknown }).teaching !== record.teaching) throw failure();
    const stored = inspect(record.receipt);
    if (
      stored.classId !== expected.classId ||
      stored.userId !== expected.userId ||
      stored.attempt !== expected.attempt
    )
      throw failure();
    return stored;
  }
  return {
    capture,
    check,
    accept,
    require,
    verifyIfReviewed,
    boundIfReviewed,
    bind,
    sealSeed,
    materializeSeed,
  };
}
