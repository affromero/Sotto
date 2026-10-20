import { isDeepStrictEqual } from 'node:util';
import { materialVisualCoverageSchema } from '@sotto/shared';
import { prismaUnfiltered } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureCodexMaterialBinding } from '@/lib/agent-usage/providers/codex';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { prepareMaterialPageText } from '../extraction/chunks';
import { readMaterialArtifact } from '../extraction/artifacts';
import {
  requireMaterialRun,
  publishMaterialPageText,
  type MaterialRunIdentity,
} from '../extraction/persistence';
import type { MaterialPdfPage } from '../extraction/pdf-protocol';
import {
  createMaterialRecognitionOperation,
  readMaterialRecognitionIdentity,
  readMaterialRecognitionReceipt,
  materialRecognitionHttpStore,
  materialRecognitionCliStore,
  markMaterialRecognitionUnknown,
} from './persistence';
import {
  prepareMaterialRecognition,
  rebuildMaterialRecognitionInput,
  materialRecognitionSourceSchema,
  MaterialRecognitionUnsupported,
  type MaterialTranscription,
} from './protocol';
import {
  executeMaterialRecognitionHttp,
  executeMaterialRecognitionCli,
  replayMaterialRecognitionHttp,
  replayMaterialRecognitionCli,
  MaterialRecognitionExecutionError,
} from './execute';
import { validateMaterialRecognitionCapability } from './capabilities';
import { restoreMaterialRecognitionAi, type MaterialRecognitionPolicy } from './policy';

export interface MaterialPageRecognitionInput {
  run: MaterialRunIdentity;
  policy: MaterialRecognitionPolicy;
  page: MaterialPdfPage;
  directory: string;
  execution: SottoProviderExecution;
  unresolved: () => void;
}

async function publish(input: MaterialPageRecognitionInput, visualInput: unknown, text?: string) {
  const visual = materialVisualCoverageSchema.parse(visualInput);
  await sottoTransaction(
    prismaUnfiltered,
    async (database) => {
      await input.execution.authorize(database);
      await requireMaterialRun(database, input.run);
      const page = await database.materialPage.findUniqueOrThrow({
        where: {
          runId_pageNumber: { runId: input.run.runId, pageNumber: input.page.pageNumber },
        },
      });
      if (!page.pageImageSha256 || page.pageImageSha256 !== input.page.image?.sha256)
        throw new Error('The assessed material page render changed.');
      if (text !== undefined) {
        const prepared = prepareMaterialPageText({
          text,
          pageNumber: page.pageNumber,
          source: {
            origin: 'VISUAL_RECOGNITION',
            method: 'CAPTURED_MODEL_FULL_PAGE_TRANSCRIPTION',
            version: input.policy.selection.capabilitySha256,
          },
        });
        await publishMaterialPageText(database, input.run, prepared.manifest, prepared.chunks);
      }
      if (
        ['RECOGNIZED', 'BLANK'].includes(
          materialVisualCoverageSchema.parse(page.visualCoverage).state
        ) &&
        !isDeepStrictEqual(page.visualCoverage, visual)
      )
        throw new Error('A complete visual page receipt cannot be overwritten.');
      await database.materialPage.update({
        where: { id: page.id },
        data: { visualCoverage: visual },
      });
    },
    { signal: input.execution.signal }
  );
}

/** One native full-page image per operation. Oversized or uncertain content stays explicitly unresolved. */
export async function recognizeMaterialPage(input: MaterialPageRecognitionInput) {
  if (!input.page.image) return;
  const evidence = {
    assessor: {
      method: 'CAPTURED_MODEL_FULL_PAGE_TRANSCRIPTION',
      version: input.policy.selection.capabilitySha256,
    },
    pageImageSha256: input.page.image.sha256,
    extent: 'FULL_PAGE' as const,
  };
  const signal = input.execution.signal ?? new AbortController().signal;
  try {
    if (input.page.image.byteSize > input.policy.capability.maxDecodedBytes)
      throw new MaterialRecognitionUnsupported(
        'The full-resolution page exceeds the reviewed image byte budget. The complete original remains retained.'
      );
    const bytes = await readMaterialArtifact(
      input.directory,
      input.page.image,
      input.policy.capability.maxDecodedBytes
    );
    const images = [{ index: 0, bytes }];
    const prior = await sottoTransaction(
      prismaUnfiltered,
      async (database) => {
        await input.execution.authorize(database);
        await requireMaterialRun(database, input.run);
        const operations = await database.materialRecognitionOperation.findMany({
          where: { runId: input.run.runId, pageNumber: input.page.pageNumber },
          take: 2,
        });
        if (operations.length > 1)
          throw new Error('A full-page recognition has conflicting admitted operations.');
        const operation = operations[0];
        if (!operation) return null;
        const context = { run: input.run, execution: input.execution, operationId: operation.id };
        return {
          operation,
          identity: await readMaterialRecognitionIdentity(database, context),
          saved: await readMaterialRecognitionReceipt(database, context),
        };
      },
      { signal }
    );
    let transcription: MaterialTranscription;
    if (prior?.saved.receipt && prior.saved.status === 'SUCCEEDED') {
      const prepared = rebuildMaterialRecognitionInput({ ...prior.identity, images });
      try {
        transcription =
          prior.saved.receipt.kind === 'HTTP'
            ? await replayMaterialRecognitionHttp({
                prepared,
                receipt: prior.saved.receipt.value,
                signal,
              })
            : replayMaterialRecognitionCli(prepared, prior.saved.receipt.value);
      } catch (cause) {
        signal.throwIfAborted();
        throw new MaterialRecognitionExecutionError('OUTPUT_INVALID', prepared.inputDigest, {
          cause,
        });
      }
    } else {
      if (prior && ['DISPATCHING', 'UNKNOWN'].includes(prior.saved.status)) {
        await sottoTransaction(prismaUnfiltered, (database) =>
          markMaterialRecognitionUnknown(database, {
            run: input.run,
            execution: input.execution,
            operationId: prior.operation.id,
          })
        );
        input.unresolved();
        throw new MaterialRecognitionExecutionError('UNKNOWN', prior.operation.inputDigest, {});
      }
      if (prior?.saved.status === 'FAILED') {
        await publish(input, {
          ...evidence,
          state: 'FAILED',
          diagnostic: 'The admitted model request failed. Its receipt remains retained.',
        });
        return;
      }
      const ai = await restoreMaterialRecognitionAi(input.policy, input.execution);
      const source = await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          await input.execution.authorize(database);
          const run = await requireMaterialRun(database, input.run);
          const material = await database.courseMaterial.findUniqueOrThrow({
            where: { id: input.run.materialId },
          });
          const user = await database.user.findUniqueOrThrow({ where: { id: input.run.userId } });
          await validateMaterialRecognitionCapability(database, input.policy.capability);
          return materialRecognitionSourceSchema.parse({
            schemaVersion: 1,
            runtimeRevision: input.policy.runtimeRevision,
            material: {
              id: material.id,
              userId: user.id,
              generation: material.createdAt.getTime(),
              ownerGeneration: user.createdAt.getTime(),
              processingRevision: material.processingRevision,
              originalSha256: input.run.originalSha256,
            },
            page: {
              number: input.page.pageNumber,
              width: input.page.image!.width,
              height: input.page.image!.height,
              imageSha256: input.page.image!.sha256,
            },
            renderer: {
              method: 'PDFJS_PAGE_TEXT_AND_DISPLAY_RENDER',
              version: run.rendererVersion,
              dpi: input.page.image!.scale * 72,
              rotation: String(input.page.rotation ?? 0),
              includeAnnotations: true,
              background: 'WHITE',
              format: 'PNG',
            },
            tiles: [
              {
                index: 0,
                x: 0,
                y: 0,
                width: input.page.image!.width,
                height: input.page.image!.height,
                imageSha256: input.page.image!.sha256,
              },
            ],
          });
        },
        { signal }
      );
      const prepared = prepareMaterialRecognition({
        ai,
        capability: input.policy.capability,
        source,
        images,
      });
      const operation = await sottoTransaction(
        prismaUnfiltered,
        async (database) => {
          const run = await requireMaterialRun(database, input.run);
          return createMaterialRecognitionOperation(database, {
            run: input.run,
            ai,
            prepared,
            mode: input.policy.cliBinding ? 'CLI' : 'HTTP',
            ...(input.policy.cliBinding ? { cliBinding: input.policy.cliBinding } : {}),
            expiresAt: run.createdAt.getTime() + 24 * 60 * 60 * 1000,
          });
        },
        { signal }
      );
      const context = { run: input.run, ai, operationId: operation.id };
      const http = materialRecognitionHttpStore(context);
      const checkedHttp = {
        admit: async (...args: Parameters<typeof http.admit>) => {
          await validateMaterialRecognitionCapability(args[0], input.policy.capability);
          return http.admit(...args);
        },
        settle: http.settle,
      };
      if (input.policy.cliBinding) {
        const cli = materialRecognitionCliStore({
          ...context,
          validateBinding: async (database, expected) => {
            await input.execution.authorize(database);
            const captured = await captureCodexMaterialBinding(input.execution, {
              model: input.policy.selection.model,
            });
            if (
              captured.fingerprint !== expected.fingerprint ||
              captured.selection.configurationSha256 !== expected.revision
            )
              throw new Error('The admitted local CLI account or configuration changed.');
          },
        });
        const checkedCli = {
          ...cli,
          admit: async (...args: Parameters<typeof cli.admit>) => {
            await validateMaterialRecognitionCapability(args[0], input.policy.capability);
            return cli.admit(...args);
          },
        };
        transcription = await executeMaterialRecognitionCli({
          ai,
          prepared,
          binding: input.policy.cliBinding,
          operation: checkedCli,
          signal,
          unresolved: input.unresolved,
        });
      } else {
        transcription = await executeMaterialRecognitionHttp({
          ai,
          prepared,
          operation: checkedHttp,
          signal,
          unresolved: input.unresolved,
        });
      }
    }
    const tile = transcription.tiles[0];
    if (!tile || transcription.tiles.length !== 1)
      throw new Error('The page transcription lost its complete tile inventory.');
    const embeddedNonempty = input.page.text.manifest?.hasNonWhitespace ?? false;
    const reliableRender = input.page.diagnostics.length === 0;
    const recognized = reliableRender && tile.state === 'TRANSCRIBED' && tile.fullVisibleCoverage;
    const blank =
      reliableRender && tile.state === 'BLANK' && tile.fullVisibleCoverage && !embeddedNonempty;
    await publish(
      input,
      {
        ...evidence,
        state: recognized ? 'RECOGNIZED' : blank ? 'BLANK' : 'UNCERTAIN',
        diagnostic: recognized
          ? 'The configured model accounted for the complete visible page.'
          : blank
            ? 'The configured model explicitly assessed the complete page as blank.'
            : 'The page includes unreadable, uncertain or unrepresented visible content.',
      },
      tile.transcription
    );
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof MaterialRecognitionExecutionError && error.outcome === 'UNKNOWN') {
      input.unresolved();
      throw error;
    }
    if (error instanceof MaterialRecognitionUnsupported) {
      await publish(input, { state: 'UNAVAILABLE', diagnostic: error.message });
      return;
    }
    if (
      error instanceof MaterialRecognitionExecutionError &&
      ['FAILED', 'OUTPUT_INVALID', 'NOT_DISPATCHED'].includes(error.outcome)
    ) {
      await publish(input, {
        ...evidence,
        state: 'FAILED',
        diagnostic:
          'The configured model did not return a valid complete page assessment. Its admitted receipt remains retained.',
      });
      return;
    }
    throw error;
  }
}
