import type { CapturedLearningAi } from '../../../learning-ai';
import type { ComposedWritingPrompt, WritingPromptsParams } from '../../../class-writing-generator';
import { learningCredentialFingerprint } from '../../preparation-selection';
import { SectionQualityError } from '../../section-quality';

export type InitialA1WritingReceipt = { readonly __initialA1WritingReceipt: unique symbol };
export type InitialA1WritingSnapshot = {
  classId: string;
  courseId: string;
  userId: string;
  attempt: number;
  sectionId: string;
  seed: string;
  prompts: Array<ComposedWritingPrompt & { id: string; order: number }>;
};

function project(prompts: readonly ComposedWritingPrompt[]) {
  return prompts.map(({ task, guidance, ideas }) => ({ task, guidance, ideas: [...ideas] }));
}

function context(params: WritingPromptsParams) {
  return JSON.stringify({
    taskMode: params.taskMode,
    userId: params.userId,
    level: params.level,
    nativeLang: params.nativeLang,
    targetLang: params.targetLang,
    objective: params.objective,
    targetVocab: params.targetVocab,
    note: params.note,
    teaching: params.teaching,
    reviewScope: params.reviewScope,
  });
}

/** The writing generator alone retains capture and acceptance authority. */
export function createWritingReviewAuthority() {
  type Snapshot = ReturnType<typeof capture>;
  const accepted = new WeakMap<ComposedWritingPrompt[], Snapshot>();
  const receipts = new WeakMap<
    InitialA1WritingReceipt,
    {
      prompts: ComposedWritingPrompt[];
      params: WritingPromptsParams;
      stored: InitialA1WritingSnapshot;
    }
  >();
  const seeds = new WeakMap<object, { receipt: InitialA1WritingReceipt; teaching: object }>();
  const failure = () =>
    new SectionQualityError('The initial A1 writing review is no longer valid.');

  function capture(
    prompts: ComposedWritingPrompt[],
    authored: readonly unknown[],
    params: WritingPromptsParams,
    ai: CapturedLearningAi
  ) {
    const scope = params.reviewScope;
    const execution = params.execution;
    if (
      params.level !== 'A1' ||
      params.taskMode !== 'translation' ||
      !params.teaching ||
      !scope?.classId ||
      !scope.courseId ||
      !Number.isSafeInteger(scope.attempt) ||
      scope.attempt < 1 ||
      execution.initialA1Class !== true ||
      execution.userId !== params.userId ||
      ai.execution.userId !== params.userId ||
      ai.execution.initialA1Class !== true ||
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
      params,
      execution,
      ai,
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
      context: context(params),
      authored,
      authoredJson: JSON.stringify(authored),
      publicJson: JSON.stringify(project(prompts)),
    };
  }

  function check(
    prompts: ComposedWritingPrompt[],
    params: WritingPromptsParams,
    snapshot: Snapshot
  ) {
    const current = capture(prompts, snapshot.authored, params, snapshot.ai);
    if (
      snapshot.params !== params ||
      snapshot.execution !== current.execution ||
      snapshot.aiExecution !== current.aiExecution ||
      snapshot.authorize !== current.authorize ||
      snapshot.signal !== current.signal ||
      snapshot.providerRequest !== current.providerRequest ||
      snapshot.sourceDocuments !== current.sourceDocuments ||
      snapshot.onCleanupError !== current.onCleanupError ||
      snapshot.registerAudioEpisode !== current.registerAudioEpisode ||
      snapshot.markCleanupUnconfirmed !== current.markCleanupUnconfirmed ||
      snapshot.selection !== current.selection ||
      snapshot.apiKey !== current.apiKey ||
      snapshot.context !== current.context ||
      snapshot.authoredJson !== current.authoredJson ||
      snapshot.publicJson !== current.publicJson
    )
      throw failure();
  }

  function accept(
    prompts: ComposedWritingPrompt[],
    params: WritingPromptsParams,
    snapshot: Snapshot
  ) {
    check(prompts, params, snapshot);
    accepted.set(prompts, snapshot);
  }

  function require(
    prompts: ComposedWritingPrompt[],
    params: WritingPromptsParams,
    assessed?: readonly ComposedWritingPrompt[]
  ) {
    const snapshot = accepted.get(prompts);
    if (!snapshot) throw failure();
    check(prompts, params, snapshot);
    if (assessed && snapshot.publicJson !== JSON.stringify(project(assessed))) throw failure();
  }

  function bind(
    prompts: ComposedWritingPrompt[],
    params: WritingPromptsParams,
    assessed: readonly ComposedWritingPrompt[],
    sectionId: string,
    seed: string,
    ids: readonly string[]
  ) {
    require(prompts, params, assessed);
    const scope = params.reviewScope;
    if (
      !scope ||
      !sectionId ||
      !seed ||
      ids.length !== prompts.length ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      throw failure();
    const receipt = Object.freeze({}) as InitialA1WritingReceipt;
    receipts.set(receipt, {
      prompts,
      params,
      stored: {
        ...scope,
        userId: params.userId,
        sectionId,
        seed,
        prompts: project(assessed).map((prompt, index) => ({
          ...prompt,
          id: ids[index]!,
          order: index + 1,
        })),
      },
    });
    return receipt;
  }

  function inspect(receipt: InitialA1WritingReceipt) {
    const record = receipts.get(receipt);
    if (!record) throw failure();
    require(record.prompts, record.params);
    if (JSON.stringify(project(record.prompts)) !== JSON.stringify(project(record.stored.prompts)))
      throw failure();
    return structuredClone(record.stored);
  }

  function sealSeed(
    seed: object,
    teaching: object,
    receipt: InitialA1WritingReceipt,
    scope: {
      classId: string;
      courseId: string;
      userId: string;
      attempt: number;
      level: string;
      nativeLang: string;
      targetLang: string;
      objective: string;
      targetVocab: WritingPromptsParams['targetVocab'];
      note?: string;
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
      JSON.stringify(record.params.targetVocab) !== JSON.stringify(scope.targetVocab)
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
  return { capture, accept, require, bind, sealSeed, materializeSeed };
}
