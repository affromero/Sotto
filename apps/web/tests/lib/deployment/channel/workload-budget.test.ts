// @vitest-environment node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  reviewWorkloadCheckpointSchema,
  type ReviewWorkloadCheckpoint,
} from '../../../../../../scripts/deploy/review/runtime/workload';
import { audio, fixture } from '../../../helpers/review-workload/fixture';
import type { WorkloadChildSummary } from '../../../helpers/review-workload/channel-child';

describe('actual workload acknowledgement channel', () => {
  it('finishes both profiles after more than 100 independently acknowledged fences', async () => {
    const input = fixture().input;
    const acknowledgements: { type: string; id: number }[] = [];
    const checkpoints: { id: number; value: ReviewWorkloadCheckpoint }[] = [];
    let result: unknown;
    let summary: WorkloadChildSummary | undefined;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--max-old-space-size=192',
          '--require',
          'tsx/cjs',
          '-e',
          'require("./tests/helpers/review-workload/channel-child.ts")',
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: 'postgresql://unreachable:fixture@127.0.0.1:1/unreachable',
          },
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        }
      );
      const { stdin, stdout, stderr } = child;
      assert(stdin && stdout && stderr, 'Private channel pipes required');
      let buffer = '';
      let diagnostics = '';
      let total = 0;
      let pendingCheckpoint: number | undefined;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Actual workload channel timed out'));
      }, 19_000);
      const fail = (error: unknown) => {
        child.kill('SIGKILL');
        reject(error);
      };
      const ack = (type: string, id: number) => {
        assert.equal(id, acknowledgements.length + 1, 'One monotonic acknowledgement sequence');
        acknowledgements.push({ type, id });
        stdin.write(JSON.stringify({ type: 'ack', id }) + '\n');
      };
      stdout.on('data', (chunk: Buffer) => {
        try {
          total += chunk.length;
          assert(total <= 2_097_152, 'Bounded channel output required');
          buffer += chunk.toString();
          while (buffer.includes('\n')) {
            const end = buffer.indexOf('\n');
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!line.startsWith('SOTTO_REVIEW_IPC=')) continue;
            const event = JSON.parse(line.slice('SOTTO_REVIEW_IPC='.length));
            assert.equal(pendingCheckpoint, undefined);
            if (event.type === 'result') {
              result = event.value;
              stdin.end();
            } else if (event.type === 'fence') {
              ack(event.type, event.id);
            } else {
              assert.equal(event.type, 'workloadCheckpoint');
              const checkpoint = reviewWorkloadCheckpointSchema.parse(event.value);
              checkpoints.push({ id: event.id, value: checkpoint });
              pendingCheckpoint = event.id;
              // Synchronize the HTTP fixture's durable state before the real stdin ack.
              child.send({ id: event.id, checkpoint });
            }
          }
        } catch (error) {
          fail(error);
        }
      });
      child.on(
        'message',
        (message: WorkloadChildSummary | { type: 'checkpointStored'; id: number }) => {
          try {
            if (message.type === 'summary') summary = message;
            else {
              assert.equal(message.id, pendingCheckpoint);
              ack('workloadCheckpoint', message.id);
              pendingCheckpoint = undefined;
            }
          } catch (error) {
            fail(error);
          }
        }
      );
      stderr.on('data', (chunk: Buffer) => {
        diagnostics += chunk.toString();
      });
      stdin.on('error', fail);
      child.once('error', fail);
      child.once('close', (status) => {
        clearTimeout(timer);
        if (status !== 0 || result === undefined || summary === undefined)
          reject(
            new Error(
              `Actual channel failed (${status}), acknowledged ${acknowledgements.length}:\n${diagnostics}`
            )
          );
        else resolve();
      });
      stdin.write(JSON.stringify({ mode: 'workloads', input, checkpoint: null }) + '\n');
    });
    const hash = createHash('sha256').update(audio()).digest('hex');
    expect(result).toEqual({
      profileCount: 2,
      generatedClasses: 2,
      syntheticAssessments: 2,
      humanPronunciationVerified: false,
      codexWorkload: 'verified',
      selectedSpeechWorkload: 'verified',
      speechSelections: input.profiles.map((profile) => profile.selection),
      referenceAudioSha256: [hash, hash],
    });
    expect(acknowledgements.filter((event) => event.type === 'fence').length).toBeGreaterThan(100);
    expect(checkpoints.some((checkpoint) => checkpoint.id > 100)).toBe(true);
    expect(
      checkpoints.every(({ value }) => value.startedAt === checkpoints[0].value.startedAt)
    ).toBe(true);
    expect(checkpoints.at(-1)?.value).toEqual(summary?.checkpoint);
    expect(
      summary?.checkpoint?.profiles.map((profile) => ({
        id: profile.profileId,
        classId: profile.classId,
        recordingId: profile.recordingId,
        verified: profile.verified,
        hash: profile.reference?.sha256,
      }))
    ).toEqual(
      ['owner', 'member'].map((id) => ({
        id,
        classId: `class-${id}`,
        recordingId: `recording-${id}`,
        verified: true,
        hash,
      }))
    );
    expect(summary?.pollDelays).toBe(220);
    expect(summary?.elapsed).toBe(220 * 5000);
    for (const id of ['owner', 'member']) {
      expect(
        summary?.requests.filter(
          (path) => path === `GET /api/v1/courses/fixture-course-${id}/preparation`
        )
      ).toHaveLength(111);
      expect(
        summary?.mutations
          .filter((mutation) => mutation.profile === id)
          .map((mutation) => mutation.path)
      ).toEqual([
        '/api/v1/courses',
        `/api/v1/courses/fixture-course-${id}/next-class?background=1`,
        `/api/v1/classes/class-${id}/speaking/prompt-${id}-0`,
      ]);
    }
    expect(JSON.stringify(checkpoints)).not.toContain(input.householdPassword);
    expect(JSON.stringify(checkpoints)).not.toContain('private-cookie');
  });
});
