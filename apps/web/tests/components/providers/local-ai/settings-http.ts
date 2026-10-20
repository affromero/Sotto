import {
  credentialSaveRequestSchema,
  type CredentialSettingsSnapshot,
} from 'thesidedoor-core/configuration/credential-client';

export function settingsHttp() {
  let snapshot: CredentialSettingsSnapshot = {
    context: {
      instanceId: 'settings-laboratory',
      scope: 'ai-keys',
      owner: { subjectId: 'student', generation: 3 },
    },
    heads: { local: null },
    keys: [],
  };
  const writes: Array<{ url: string; options: RequestInit }> = [];
  let configure: () => Promise<Response> = async () => Response.json({});
  let mutate: () => Promise<void> = async () => {};
  let inconclusive = false;
  return {
    writes,
    configure(response: () => Promise<Response>) {
      configure = response;
    },
    mutate(response: () => Promise<void>) {
      mutate = response;
    },
    inconclusive() {
      inconclusive = true;
    },
    async fetch(input: RequestInfo | URL, options: RequestInit = {}) {
      const url = String(input);
      if (!options.method) return Response.json(snapshot);
      writes.push({ url, options });
      if (url.endsWith('/site-config')) return configure();
      await mutate();
      const command = credentialSaveRequestSchema.parse(JSON.parse(String(options.body)));
      if (command.expectedRevision !== snapshot.heads.local)
        return Response.json({}, { status: 409 });
      if (inconclusive && !command.allowUnverified)
        return Response.json({
          status: 'needs_confirmation',
          operationId: command.operationId,
          context: command.context,
          validation: { status: 'inconclusive', readiness: { code: 'unreachable', checkedAt: 7 } },
        });
      snapshot = {
        ...snapshot,
        heads: { local: command.operationId },
        keys: [
          {
            provider: 'local',
            revision: command.operationId,
            isValid: true,
            verification: {
              lastAttempt: { status: inconclusive ? 'inconclusive' : 'verified', checkedAt: 7 },
              lastConfirmed: inconclusive ? null : { status: 'verified', checkedAt: 7 },
            },
          },
        ],
      };
      return Response.json({
        status: 'saved',
        revision: command.operationId,
        context: command.context,
        validation: {
          status: inconclusive ? 'inconclusive' : 'valid',
          readiness: {
            code: inconclusive ? 'unreachable' : 'ready',
            checkedAt: 7,
          },
        },
      });
    },
  };
}
