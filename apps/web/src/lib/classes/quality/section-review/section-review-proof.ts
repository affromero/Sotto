import type { CapturedLearningAi } from '../../../learning-ai';
import type { GeneratedQuestion, SectionGenParams } from '../../../class-generation';
import type { SottoProviderExecution } from '../../../sidedoor/credentials/runtime/provider-execution';
import { learningCredentialFingerprint } from '../../preparation-selection';
import { SectionQualityError } from '../../section-quality';

export type InitialA1SectionReceipt = { readonly __initialA1SectionReceipt: unique symbol };
export type InitialA1SectionSnapshot = {
  classId: string;
  courseId: string;
  userId: string;
  sectionId: string;
  skill: 'GRAMMAR' | 'READING';
  attempt: number;
  seed: string;
  questions: Array<
    ReturnType<typeof reviewedQuestionProjection>[number] & { id: string; order: number }
  >;
};

/** Fields that determine the visible task, its private key, and its feedback. */
function reviewedQuestionProjection(questions: readonly GeneratedQuestion[]) {
  return questions.map((question) => ({
    question: question.question,
    options: [...question.options],
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    passageRef: question.passageRef ?? null,
    passageText: question.passageText ?? null,
  }));
}

function context(params: SectionGenParams): string {
  return JSON.stringify({
    userId: params.userId,
    skill: params.skill,
    level: params.level,
    nativeLang: params.nativeLang,
    targetLang: params.targetLang,
    objective: params.objective,
    grammarPoints: params.grammarPoints,
    targetVocab: params.targetVocab,
    seed: params.seed,
    note: params.note,
    teaching: params.teaching,
    retry: params.retry,
    sourceContent: params.sourceContent,
    reviewScope: params.reviewScope,
    vocabularyReview: params.vocabularyReview,
  });
}

function selection(ai: CapturedLearningAi): string {
  return JSON.stringify({
    provider: ai.provider,
    model: ai.model,
    endpoint: ai.endpoint,
    isolatedImage: ai.isolatedImage,
    initialA1Class: ai.execution.initialA1Class,
    userId: ai.execution.userId,
    credentialFingerprint: learningCredentialFingerprint(ai.execution.credential),
    learningSelection: ai.execution.learningSelection,
    workspace: ai.execution.isolatedWorkspace?.directory,
  });
}

function executionSelection(execution: SottoProviderExecution): string {
  return JSON.stringify({
    userId: execution.userId,
    initialA1Class: execution.initialA1Class,
    credentialFingerprint: learningCredentialFingerprint(execution.credential),
    learningSelection: execution.learningSelection,
    ttsModel: execution.ttsModel,
    workspace: execution.isolatedWorkspace?.directory,
  });
}

/** Only the generator retains this authority; callers can only check its receipts. */
export function createSectionReviewAuthority() {
  type Snapshot = {
    candidate: string;
    context: string;
    selection: string;
    apiKey: CapturedLearningAi['apiKey'];
    params: SectionGenParams;
    execution: SectionGenParams['execution'];
    authorize: SectionGenParams['execution']['authorize'];
    signal: AbortSignal | undefined;
    providerRequest: SectionGenParams['execution']['providerRequest'];
    sourceDocuments: SectionGenParams['execution']['sourceDocuments'];
    onCleanupError: SectionGenParams['execution']['onCleanupError'];
    registerAudioEpisode: SectionGenParams['execution']['registerAudioEpisode'];
    markCleanupUnconfirmed:
      | NonNullable<SectionGenParams['execution']['isolatedWorkspace']>['markCleanupUnconfirmed']
      | undefined;
    executionSelection: string;
    aiExecution: CapturedLearningAi['execution'];
    ai: CapturedLearningAi;
  };
  const accepted = new WeakMap<GeneratedQuestion[], Snapshot>();
  const receipts = new WeakMap<
    InitialA1SectionReceipt,
    {
      candidate: GeneratedQuestion[];
      params: SectionGenParams;
      snapshot: InitialA1SectionSnapshot;
    }
  >();
  const seeds = new WeakMap<
    object,
    { receipts: InitialA1SectionReceipt[]; teaching: SectionGenParams['teaching'] }
  >();
  const failure = () =>
    new SectionQualityError('The initial A1 exercise review is no longer valid.');

  function requireScope(params: SectionGenParams, ai: CapturedLearningAi) {
    const scope = params.reviewScope;
    if (
      params.level !== 'A1' ||
      params.execution.initialA1Class !== true ||
      params.vocabularyReview ||
      !params.teaching ||
      !scope?.classId ||
      !scope.courseId ||
      !scope.sectionId ||
      !Number.isSafeInteger(scope.attempt) ||
      scope.attempt < 1 ||
      params.execution.userId !== params.userId ||
      ai.execution.userId !== params.userId ||
      ai.execution.initialA1Class !== true ||
      ai.execution.authorize !== params.execution.authorize ||
      ai.execution.signal !== params.execution.signal ||
      ai.execution.providerRequest !== params.execution.providerRequest ||
      ai.execution.sourceDocuments !== params.execution.sourceDocuments ||
      ai.execution.onCleanupError !== params.execution.onCleanupError ||
      ai.execution.registerAudioEpisode !== params.execution.registerAudioEpisode ||
      ai.execution.isolatedWorkspace?.markCleanupUnconfirmed !==
        params.execution.isolatedWorkspace?.markCleanupUnconfirmed
    )
      throw failure();
    params.execution.signal?.throwIfAborted();
  }

  function capture(
    candidate: GeneratedQuestion[],
    params: SectionGenParams,
    ai: CapturedLearningAi
  ): Snapshot {
    requireScope(params, ai);
    return {
      candidate: JSON.stringify(reviewedQuestionProjection(candidate)),
      context: context(params),
      selection: selection(ai),
      apiKey: ai.apiKey,
      params,
      execution: params.execution,
      authorize: params.execution.authorize,
      signal: params.execution.signal,
      providerRequest: params.execution.providerRequest,
      sourceDocuments: params.execution.sourceDocuments,
      onCleanupError: params.execution.onCleanupError,
      registerAudioEpisode: params.execution.registerAudioEpisode,
      markCleanupUnconfirmed: params.execution.isolatedWorkspace?.markCleanupUnconfirmed,
      executionSelection: executionSelection(params.execution),
      aiExecution: ai.execution,
      ai,
    };
  }

  function check(candidate: GeneratedQuestion[], params: SectionGenParams, proof: Snapshot) {
    requireScope(params, proof.ai);
    if (
      proof.params !== params ||
      proof.execution !== params.execution ||
      proof.authorize !== params.execution.authorize ||
      proof.signal !== params.execution.signal ||
      proof.providerRequest !== params.execution.providerRequest ||
      proof.sourceDocuments !== params.execution.sourceDocuments ||
      proof.onCleanupError !== params.execution.onCleanupError ||
      proof.registerAudioEpisode !== params.execution.registerAudioEpisode ||
      proof.markCleanupUnconfirmed !== params.execution.isolatedWorkspace?.markCleanupUnconfirmed ||
      proof.executionSelection !== executionSelection(params.execution) ||
      proof.aiExecution !== proof.ai.execution ||
      proof.apiKey !== proof.ai.apiKey ||
      proof.selection !== selection(proof.ai) ||
      proof.context !== context(params) ||
      proof.candidate !== JSON.stringify(reviewedQuestionProjection(candidate))
    )
      throw failure();
  }

  function accept(candidate: GeneratedQuestion[], params: SectionGenParams, proof: Snapshot) {
    check(candidate, params, proof);
    accepted.set(candidate, proof);
    return candidate;
  }

  function require(
    candidate: GeneratedQuestion[],
    params: SectionGenParams,
    assessed?: readonly GeneratedQuestion[]
  ) {
    const proof = accepted.get(candidate);
    if (!proof) throw failure();
    check(candidate, params, proof);
    if (assessed && proof.candidate !== JSON.stringify(reviewedQuestionProjection(assessed)))
      throw failure();
    return structuredClone(reviewedQuestionProjection(candidate));
  }

  function bind(
    candidate: GeneratedQuestion[],
    params: SectionGenParams,
    assessed: readonly GeneratedQuestion[],
    ids: readonly string[]
  ): InitialA1SectionReceipt {
    const projection = require(candidate, params, assessed);
    const scope = params.reviewScope;
    if (
      !scope ||
      (params.skill !== 'GRAMMAR' && params.skill !== 'READING') ||
      ids.length !== projection.length ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      throw failure();
    const receipt = Object.freeze({}) as InitialA1SectionReceipt;
    receipts.set(receipt, {
      candidate,
      params,
      snapshot: {
        ...scope,
        userId: params.userId,
        skill: params.skill,
        seed: params.seed,
        questions: projection.map((question, index) => ({
          ...question,
          id: ids[index]!,
          order: index + 1,
        })),
      },
    });
    return receipt;
  }

  function inspect(receipt: InitialA1SectionReceipt): InitialA1SectionSnapshot {
    const record = receipts.get(receipt);
    if (!record) throw failure();
    const projection = require(record.candidate, record.params);
    const scope = record.params.reviewScope;
    const storedProjection = record.snapshot.questions.map((question) => ({
      question: question.question,
      options: question.options,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      passageRef: question.passageRef,
      passageText: question.passageText,
    }));
    if (!scope || JSON.stringify(projection) !== JSON.stringify(storedProjection)) throw failure();
    return structuredClone(record.snapshot);
  }

  function sealSeed(
    seed: object,
    teaching: SectionGenParams['teaching'],
    sectionReceipts: readonly InitialA1SectionReceipt[],
    scope: {
      classId: string;
      courseId: string;
      userId: string;
      attempt: number;
      skills: readonly ('GRAMMAR' | 'READING')[];
      level: string;
      nativeLang: string;
      targetLang: string;
      objective: string;
      grammarPoints: SectionGenParams['grammarPoints'];
      targetVocab: SectionGenParams['targetVocab'];
      note?: string;
      sourceContent?: string;
    }
  ) {
    const snapshots = sectionReceipts.map(inspect);
    if (
      !teaching ||
      new Set(scope.skills).size !== scope.skills.length ||
      snapshots.length !== scope.skills.length ||
      snapshots.some((value, index) => {
        const params = receipts.get(sectionReceipts[index]!)?.params;
        return (
          !params ||
          !scope.skills.includes(value.skill) ||
          snapshots.findIndex((item) => item.skill === value.skill) !== index ||
          value.classId !== scope.classId ||
          value.courseId !== scope.courseId ||
          value.userId !== scope.userId ||
          value.attempt !== scope.attempt ||
          params.teaching !== teaching ||
          params.level !== scope.level ||
          params.nativeLang !== scope.nativeLang ||
          params.targetLang !== scope.targetLang ||
          params.objective !== scope.objective ||
          params.note !== scope.note ||
          params.sourceContent !== scope.sourceContent ||
          params.retry !== undefined ||
          JSON.stringify(params.grammarPoints) !== JSON.stringify(scope.grammarPoints) ||
          JSON.stringify(params.targetVocab) !== JSON.stringify(scope.targetVocab)
        );
      })
    )
      throw failure();
    seeds.set(seed, { receipts: [...sectionReceipts], teaching });
  }

  function materializeSeed(
    seed: object,
    expected: { classId: string; userId: string; attempt: number }
  ) {
    const record = seeds.get(seed);
    if (!record || (seed as { teaching?: unknown }).teaching !== record.teaching) throw failure();
    const snapshots = record.receipts.map(inspect);
    if (
      snapshots.some(
        (item) =>
          item.classId !== expected.classId ||
          item.userId !== expected.userId ||
          item.attempt !== expected.attempt
      )
    )
      throw failure();
    return snapshots;
  }

  return { capture, accept, require, bind, sealSeed, materializeSeed };
}
