import { createHash } from 'node:crypto';
import type { CapturedLearningAi } from '../../../learning-ai';
import type {
  ComposedSpeakingPrompt,
  SpeakingPromptsParams,
} from '../../../class-speaking-generator';
import { learningCredentialFingerprint } from '../../preparation-selection';
import { SectionQualityError } from '../../section-quality';

type ReviewedPhrase = { targetPhrase: string; translation: string; ipa?: string | null };
export type InitialA1SpeakingReceipt = { readonly __initialA1SpeakingReceipt: unique symbol };
export type InitialA1SpeakingSnapshot = {
  classId: string;
  courseId: string;
  userId: string;
  attempt: number;
  sectionId: string;
  seed: string;
  prompts: Array<{
    id: string;
    order: number;
    targetPhrase: string;
    translation: string;
    ipa: string | null;
    referenceTtsUrl: string | null;
    learningObjectives: null;
  }>;
};

function project(phrases: readonly ReviewedPhrase[]) {
  return phrases.map(({ targetPhrase, translation, ipa }) => ({
    targetPhrase,
    translation,
    ipa: ipa ?? null,
  }));
}

function context(params: SpeakingPromptsParams) {
  return JSON.stringify({
    userId: params.userId,
    level: params.level,
    nativeLang: params.nativeLang,
    targetLang: params.targetLang,
    objective: params.objective,
    targetVocab: params.targetVocab,
    note: params.note,
    teaching: params.teaching,
    refId: params.refId,
    ttsProvider: params.ttsProvider,
    referenceAudioRequired: params.referenceAudioRequired,
    reviewScope: params.reviewScope,
  });
}

function audioDigests(prompts: readonly ComposedSpeakingPrompt[]) {
  return prompts.map(({ referenceTtsAudio }) =>
    referenceTtsAudio ? createHash('sha256').update(referenceTtsAudio).digest('hex') : null
  );
}

/** The speaking generator alone retains capture and acceptance authority. */
export function createSpeakingReviewAuthority() {
  type Snapshot = ReturnType<typeof capture>;
  const accepted = new WeakMap<ComposedSpeakingPrompt[], { snapshot: Snapshot; audio: string }>();
  const receipts = new WeakMap<
    InitialA1SpeakingReceipt,
    {
      prompts: ComposedSpeakingPrompt[];
      params: SpeakingPromptsParams;
      stored: InitialA1SpeakingSnapshot;
    }
  >();
  const seeds = new WeakMap<object, { receipt: InitialA1SpeakingReceipt; teaching: object }>();
  const failure = () =>
    new SectionQualityError('The initial A1 speaking review is no longer valid.');

  function capture(
    candidate: readonly ReviewedPhrase[],
    params: SpeakingPromptsParams,
    ai: CapturedLearningAi
  ) {
    const scope = params.reviewScope;
    const execution = params.execution;
    if (
      params.level !== 'A1' ||
      !params.teaching ||
      !scope?.classId ||
      !scope.courseId ||
      !Number.isSafeInteger(scope.attempt) ||
      scope.attempt < 1 ||
      params.refId !== `${scope.classId}-${scope.attempt}` ||
      execution.initialA1Class !== true ||
      execution.userId !== params.userId ||
      ai.execution.initialA1Class !== true ||
      ai.execution.userId !== params.userId ||
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
      candidate,
      candidateJson: JSON.stringify(project(candidate)),
      params,
      context: context(params),
      ai,
      aiExecution: ai.execution,
      execution,
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

  function check(params: SpeakingPromptsParams, snapshot: Snapshot) {
    const current = capture(snapshot.candidate, params, snapshot.ai);
    if (
      params !== snapshot.params ||
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
      current.candidateJson !== snapshot.candidateJson
    )
      throw failure();
  }

  function accept(
    prompts: ComposedSpeakingPrompt[],
    params: SpeakingPromptsParams,
    snapshot: Snapshot
  ) {
    check(params, snapshot);
    if (JSON.stringify(project(prompts)) !== snapshot.candidateJson) throw failure();
    accepted.set(prompts, { snapshot, audio: JSON.stringify(audioDigests(prompts)) });
  }

  function require(prompts: ComposedSpeakingPrompt[], params: SpeakingPromptsParams) {
    const proof = accepted.get(prompts);
    if (!proof) throw failure();
    check(params, proof.snapshot);
    if (
      JSON.stringify(project(prompts)) !== proof.snapshot.candidateJson ||
      JSON.stringify(audioDigests(prompts)) !== proof.audio
    )
      throw failure();
  }

  function bind(
    prompts: ComposedSpeakingPrompt[],
    params: SpeakingPromptsParams,
    sectionId: string,
    seed: string,
    ids: readonly string[],
    references: ReadonlyMap<string, string>
  ) {
    require(prompts, params);
    const scope = params.reviewScope;
    if (
      !scope ||
      !sectionId ||
      !seed ||
      ids.length !== prompts.length ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length ||
      [...references.keys()].some((id) => !ids.includes(id))
    )
      throw failure();
    if (params.referenceAudioRequired && ids.some((id) => !references.get(id))) throw failure();
    const receipt = Object.freeze({}) as InitialA1SpeakingReceipt;
    receipts.set(receipt, {
      prompts,
      params,
      stored: {
        ...scope,
        userId: params.userId,
        sectionId,
        seed,
        prompts: project(prompts).map((prompt, index) => ({
          ...prompt,
          id: ids[index]!,
          order: index + 1,
          referenceTtsUrl: references.get(ids[index]!) ?? null,
          learningObjectives: null,
        })),
      },
    });
    return receipt;
  }

  function inspect(receipt: InitialA1SpeakingReceipt) {
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
    receipt: InitialA1SpeakingReceipt,
    scope: {
      classId: string;
      courseId: string;
      userId: string;
      attempt: number;
      level: string;
      nativeLang: string;
      targetLang: string;
      objective: string;
      targetVocab: SpeakingPromptsParams['targetVocab'];
      note?: string;
      ttsProvider: SpeakingPromptsParams['ttsProvider'];
      referenceAudioRequired: boolean;
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
      record.params.ttsProvider !== scope.ttsProvider ||
      record.params.referenceAudioRequired !== scope.referenceAudioRequired ||
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
  return { capture, check, accept, require, bind, sealSeed, materializeSeed };
}
