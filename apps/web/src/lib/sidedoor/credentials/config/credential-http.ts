import { z } from 'zod';
import { AccessError } from 'thesidedoor-core/access';
import { CredentialValidationError } from 'thesidedoor-core/configuration';
import { OwnedCredentialConflictError } from 'thesidedoor-core/configuration/owned-credentials';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import {
  credentialRemovalRequestSchema,
  credentialSaveRequestSchema,
  sameCredentialEditContext,
} from 'thesidedoor-core/configuration/credential-client';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import {
  listSottoCredentialSettings,
  removeSottoCredential,
  saveSottoCredential,
  SottoCredentialRejectedError,
} from '@/lib/sidedoor/credentials/config/credential-settings';
import type { CredentialScope } from '@/lib/sidedoor/access/state/state';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { requireOriginalSottoAdmission } from '@/lib/sidedoor/access/core/request-identity';

import { sottoCredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-endpoints';
import type { SottoCredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-selection-contract';
export type { SottoCredentialEndpoint } from '@/lib/sidedoor/credentials/config/credential-selection-contract';

/** App transport only. Shared schemas and services own edit semantics and persistence. */
export function createSottoCredentialSettingsHandler(endpoint: SottoCredentialEndpoint) {
  const { providers, scope } = sottoCredentialEndpoint(endpoint);

  return (request: Request): Promise<Response> =>
    accessOperation(request, false, async () => {
      const identity = await authenticateRequest(request);
      if (!identity) return errorResponse('Unauthorized', 401);
      return accessOperation(
        request,
        request.method !== 'GET' && identity.authentication === 'session',
        async () => {
          try {
            if (request.method === 'GET') {
              const groups = new Map<CredentialScope, string[]>();
              for (const provider of providers) {
                const selected = scope(provider);
                groups.set(selected, [...(groups.get(selected) ?? []), provider]);
              }
              const pages = await Promise.all(
                [...groups].map(([selected, group]) =>
                  listSottoCredentialSettings(prismaUnfiltered, {
                    request,
                    identity,
                    scope: selected,
                    providers: group,
                  })
                )
              );
              const first = pages[0];
              if (!first) throw new AccessError('invalid', 'No credential providers configured');
              const context = { ...first.context, scope: endpoint };
              if (
                pages.some(
                  (page) =>
                    !sameCredentialEditContext(context, { ...page.context, scope: endpoint })
                )
              )
                throw new AccessError('conflict', 'The credential settings owner changed');
              await sottoTransaction(
                prismaUnfiltered,
                (tx) => requireOriginalSottoAdmission(tx, request, identity),
                { signal: request.signal }
              );
              request.signal.throwIfAborted();
              return Response.json({
                context,
                keys: pages.flatMap((page) => page.keys),
                heads: Object.assign({}, ...pages.map((page) => page.heads)),
              });
            }
            if (request.method !== 'POST' && request.method !== 'DELETE')
              return errorResponse('Method not allowed', 405);
            const bytes = await readRequestBytes(request, 32_768);
            let body: unknown;
            try {
              body = JSON.parse(new TextDecoder().decode(bytes));
            } catch {
              return errorResponse('Invalid JSON request body', 400);
            }
            const command =
              request.method === 'POST'
                ? credentialSaveRequestSchema.parse(body)
                : credentialRemovalRequestSchema.parse(body);
            if (!providers.includes(command.provider) || command.context.scope !== endpoint)
              return errorResponse('Invalid credential provider or scope', 400);
            const input = { ...command, request, identity, scope: scope(command.provider) };
            if (request.method === 'POST') {
              const save = credentialSaveRequestSchema.parse(command);
              const result = await saveSottoCredential(prismaUnfiltered, { ...input, ...save });
              request.signal.throwIfAborted();
              return Response.json({ ...result, context: command.context });
            }
            const result = await removeSottoCredential(prismaUnfiltered, input);
            request.signal.throwIfAborted();
            return Response.json({ ...result, status: 'removed', context: command.context });
          } catch (error) {
            if (error instanceof RequestBodyTooLargeError)
              return errorResponse('Credential request is too large', 413);
            if (error instanceof z.ZodError || error instanceof CredentialValidationError)
              return errorResponse('Invalid credential fields or edit revision', 400);
            if (error instanceof OwnedCredentialConflictError)
              return errorResponse(
                'Credential changed. Reload its settings before editing again.',
                409
              );
            if (error instanceof SottoCredentialRejectedError)
              return errorResponse(error.message, 422, { validation: error.validation });
            throw error;
          }
        }
      );
    });
}
