import { expect, it } from 'vitest';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { classPreparationGrant } from '@/lib/classes/preparation-grant';
import { readPreparationActivity } from '@/lib/classes/preparation';
import { preparationProviderRequest } from '@/lib/classes/preparation-provider';
import type { ClassPreparation } from '@/lib/classes/preparation-state';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

interface DocumentRequestContext {
  instance: SharedTestInstance;
  courseId: string;
  execution: SottoProviderExecution;
  running: (maxProviderRequests?: number) => Promise<ClassPreparation>;
}

export function registerDocumentRequestTests(context: () => DocumentRequestContext) {
  it('admits complete document bodies beyond 4 MiB and fingerprints their final bytes', async () => {
    const { instance, running } = context();
    const operation = await running(2);
    const provider = preparationProviderRequest(operation, new AbortController().signal, () => {
      throw new Error('Unexpected uncertainty');
    });
    const document = Buffer.alloc(4 * 1024 * 1024, 'p');
    document.write('%PDF-1.7');
    const bodies: string[] = [];
    for (const ending of ['first final page', 'changed final page']) {
      const body = JSON.stringify({
        model: operation.selection.model,
        input: [
          {
            type: 'input_file',
            file_data: Buffer.concat([document, Buffer.from(ending)]).toString('base64'),
          },
        ],
      });
      const http = new Request('https://api.openai.com/v1/responses', {
        method: 'POST',
        body,
      });
      const response = await provider(http, async () => {
        bodies.push(await http.text());
        return new Response('accepted');
      });
      expect(await response.text()).toBe('accepted');
    }
    expect(
      bodies.map((body) =>
        Buffer.from(JSON.parse(body).input[0].file_data, 'base64')
          .subarray(document.length)
          .toString()
      )
    ).toEqual(['first final page', 'changed final page']);
    const grant = await sottoTransaction(instance.database, (database) =>
      classPreparationGrant(database, operation).read(operation.grant)
    );
    expect(grant.attempts.map((attempt) => attempt.outcome)).toEqual(['succeeded', 'succeeded']);
    expect(new Set(grant.attempts.map((attempt) => attempt.fingerprint)).size).toBe(2);
    expect(JSON.stringify(grant)).not.toContain('first final page');
  });

  it('rejects an oversized document request before admission or provider dispatch', async () => {
    const { courseId, execution, running } = context();
    const operation = await running();
    const provider = preparationProviderRequest(operation, new AbortController().signal, () => {
      throw new Error('Unexpected uncertainty');
    });
    let dispatched = false;
    const http = new Request('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: 'p'.repeat(72 * 1024 * 1024 + 1),
    });
    try {
      const error = await provider(http, async () => {
        dispatched = true;
        return new Response('Unexpected dispatch');
      }).then(
        () => null,
        (failure: unknown) => failure
      );
      expect(error instanceof AggregateError ? error.cause : error).toMatchObject({
        name: 'ResponseBodyTooLargeError',
      });
    } finally {
      await http.body?.cancel();
    }
    expect(dispatched).toBe(false);
    expect((await readPreparationActivity(courseId, execution))?.providerRequestsAdmitted).toBe(0);
  });
}
