import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PARAMS,
  SAMPLE_QUESTIONS_JSON,
  SAMPLE_SCRIPT_RESULT,
  setupHappyPath,
  mockGenerateScript,
  mockGenerateResponse,
  mockBlindResponse,
  mockTeachingResponse,
  mockTeachingCriticResponse,
  mockLoadAndRender,
  mockScriptCreate,
  mockClassSectionCreate,
  mockCreateSegmentsAndQueueAudio,
} from '../../../helpers/runtime/listening-generation';
import { generateClassListening } from '@/lib/class-listening-generator';
import { formatSourceBlock } from '@/lib/script-generator';
import { TeachingQualityRejectionError } from '@/lib/classes/quality/teaching-quality';
import { approved } from './blind-review-fixture';

const original = 'Lea ist nach Bonn gefahren.';
const replacement = 'Lea ist nach Köln gefahren.';
let supported: boolean;
let alwaysReject: boolean;
let scripts: string[];
const source = 'The supplied trip account.';
function useLargeScript(unchanged = false) {
  const respond = mockGenerateResponse.getMockImplementation()!;
  mockGenerateResponse.mockImplementation(async (...args) => {
    const response = await respond(...args);
    if (args[2].maxTokens !== 12288) return response;
    const script = JSON.parse(response.content);
    const turnRepair = args[2].jsonSchema?.name === 'learning_script_turn_repair';
    const text = turnRepair ? script.turnTexts['1'] : script.turns[0].text;
    const largeText = (unchanged ? original : text) + ' Lea erzählt von ihrer Reise.'.repeat(300);
    if (turnRepair) script.turnTexts['1'] = largeText;
    else script.turns[0].text = largeText;
    return { ...response, content: JSON.stringify(script) };
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  setupHappyPath();
  supported = false;
  alwaysReject = false;
  scripts = [];
  const canonical =
    await vi.importActual<typeof import('@/lib/script-generator')>('@/lib/script-generator');
  const templates =
    await vi.importActual<typeof import('@/lib/prompt-loader')>('@/lib/prompt-loader');
  mockGenerateScript.mockImplementation(canonical.generateScript);
  mockLoadAndRender.mockImplementation(templates.loadAndRender);
  mockGenerateResponse.mockImplementation(async (...args) => {
    if (args[2].maxTokens === 12288) {
      const text = scripts.length === 0 ? original : replacement;
      scripts.push(text);
      return {
        content: JSON.stringify(
          args[2].jsonSchema?.name === 'learning_script_turn_repair'
            ? { turnTexts: { '1': text } }
            : { ...SAMPLE_SCRIPT_RESULT, turns: [{ speaker: 'HOST', text }] }
        ),
        model: 'm',
      };
    }
    return { content: SAMPLE_QUESTIONS_JSON, model: 'm' };
  });
  mockBlindResponse.mockResolvedValue({
    model: 'm',
    content: JSON.stringify({
      ...approved,
      passageFindings: [
        { sourcePartIndex: 0, issue: 'incorrect', reason: 'The trip claim needs examination.' },
      ],
    }),
  });
  mockTeachingCriticResponse.mockImplementation(async (...args) => {
    const input = JSON.parse(args[1][0].content);
    return {
      model: 'm',
      content: JSON.stringify({
        items: input.items.map((row: { index: number }) => ({ index: row.index, findings: [] })),
      }),
    };
  });
  mockTeachingResponse.mockImplementation(async (...args) => {
    const input = JSON.parse(args[1][0].content);
    const reject =
      supported && (alwaysReject || input.items[0].content.passageText.includes(original));
    return {
      model: 'm',
      content: JSON.stringify({
        items: input.items.map((row: { index: number; sourceParts: Array<{ index: number }> }) => ({
          index: row.index,
          criticDecisions: [],
          newFindings:
            reject && row.index === 0
              ? [
                  {
                    sourcePartIndex: row.sourceParts[0].index,
                    issue: 'unsupported',
                    rule: 'Preserve supplied facts.',
                    defect: 'The destination differs from the source.',
                    remedy: { kind: 'correction', text: replacement },
                  },
                ]
              : [],
        })),
        passageConcernDecisions: [
          {
            concernIndex: 0,
            decision: reject ? 'supported' : 'dismissed',
            reason: 'Compared the passage claim.',
            ...(reject ? { itemIndex: 0, findingIndex: 0 } : {}),
          },
        ],
      }),
    };
  });
});

describe('canonical listening passage adjudication orchestration', () => {
  it('publishes a repaired script when the first rejection exceeds the persisted evidence limit', async () => {
    supported = true;
    useLargeScript();
    await generateClassListening({ ...PARAMS, sourceContent: source });
    expect(scripts).toEqual([original, replacement]);
    expect(mockScriptCreate.mock.calls[0][0].data.turns[0].text).toContain(replacement);
    expect(mockClassSectionCreate).toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps oversized rejected replacements terminal without publication (unchanged script: %s)',
    async (unchanged) => {
      supported = true;
      alwaysReject = true;
      useLargeScript(unchanged);
      const failure = await generateClassListening({ ...PARAMS, sourceContent: source }).catch(
        (error: unknown) => error
      );
      if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
      expect(
        failure.teachingFailure!.reviews.every(
          (review) => review.candidate === null && review.omitted === 'size_limit'
        )
      ).toBe(true);
      expect(failure.teachingFailure!.reviews).toHaveLength(unchanged ? 1 : 2);
      expect(scripts).toEqual([original, replacement]);
      expect(mockScriptCreate).not.toHaveBeenCalled();
      expect(mockClassSectionCreate).not.toHaveBeenCalled();
      expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
    }
  );
  it('publishes after dismissing the allegation without regenerating the script', async () => {
    await generateClassListening(PARAMS);
    expect(scripts).toEqual([original]);
    expect(mockScriptCreate.mock.calls[0][0].data.turns[0].text).toBe(original);
    expect(mockClassSectionCreate).toHaveBeenCalled();
  });

  it('uses the existing replacement slot and preserves exact source context in both reviewer roles', async () => {
    supported = true;
    const metadata = { title: 'The original source', author: 'A narrator' };
    const content = source + 'x'.repeat(20_100);
    const formatted = formatSourceBlock(content, metadata);
    const originalProvider = mockGenerateResponse.getMockImplementation()!;
    mockGenerateResponse.mockImplementation(async (...args) => {
      metadata.title = 'Changed after dispatch';
      return originalProvider(...args);
    });
    await generateClassListening({ ...PARAMS, sourceContent: content, sourceMetadata: metadata });
    expect(scripts).toEqual([original, replacement]);
    expect(mockScriptCreate.mock.calls[0][0].data.turns[0].text).toBe(replacement);
    const generationRequests = mockGenerateResponse.mock.calls.filter(
      (call) => call[2].maxTokens === 12288
    );
    for (const call of generationRequests) {
      expect(call[1][0].content).toContain(formatted);
      expect(call[1][0].content).not.toContain('Changed after dispatch');
    }
    for (const call of [
      ...mockTeachingCriticResponse.mock.calls,
      ...mockTeachingResponse.mock.calls,
    ]) {
      const input = JSON.parse(call[1][0].content);
      expect(input.listeningSource).toBe(formatted);
      const passageText = input.items[0].content.passageText;
      expect([`HOST: ${original}`, `HOST: ${replacement}`]).toContain(passageText);
      expect(input.listeningTurns).toEqual([
        { turnIndex: 1, speaker: 'HOST', text: passageText.slice('HOST: '.length) },
      ]);
    }
    expect(generationRequests[1][1][0].content).toContain(
      'The destination differs from the source.'
    );
    expect(generationRequests[1][1][0].content).not.toContain('The trip claim needs examination.');
  });

  it('retains both rejected candidates and never publishes or adds a third generation', async () => {
    supported = true;
    alwaysReject = true;
    const failure = await generateClassListening(PARAMS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TeachingQualityRejectionError);
    if (!(failure instanceof TeachingQualityRejectionError)) throw failure;
    expect(failure.teachingFailure?.reviews).toHaveLength(2);
    expect(scripts).toEqual([original, replacement]);
    expect(mockScriptCreate).not.toHaveBeenCalled();
    expect(mockClassSectionCreate).not.toHaveBeenCalled();
    expect(mockCreateSegmentsAndQueueAudio).not.toHaveBeenCalled();
  });
});
