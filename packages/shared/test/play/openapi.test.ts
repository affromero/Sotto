import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument, buildEndpointOperation } from '../../scripts/generate-openapi';
import { endpoints } from '../../src/contracts';

describe('Play OpenAPI capability boundaries', () => {
  it('documents proof-only admission separately from member game operations', () => {
    const full = buildOpenApiDocument();
    const paths = full.paths as Record<string, Record<string, { security?: unknown }>>;
    expect(paths['/api/v1/play/join-requests/{requestId}/claim'].post.security).toEqual([
      { playClaimantProof: [] },
    ]);
    expect(paths['/api/v1/play/invitations'].post.security).toEqual([{ playClaimantProof: [] }]);
    expect(paths['/api/v1/play/rooms/{roomId}/actions'].post.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(paths['/api/v1/play/invitations'].get.security).toBeUndefined();
    const codegen = buildOpenApiDocument({ codegen: true });
    expect(codegen.paths).not.toHaveProperty('/api/v1/play/rooms');
    expect(codegen.components).not.toHaveProperty('schemas.PlayDelivery');
  });

  it('documents claimant proof as a required private header distinct from normal app access', () => {
    const health = endpoints.find((endpoint) => endpoint.id === 'health');
    if (!health) throw new Error('Missing registered health contract');
    const claim = buildEndpointOperation({ ...health, auth: 'claimant' });
    expect(claim).toMatchObject({ security: [{ playClaimantProof: [] }] });
    expect(buildEndpointOperation({ ...health, auth: 'bearer' })).toMatchObject({
      security: [{ bearerAuth: [] }],
    });
    expect(buildEndpointOperation(health)).not.toHaveProperty('security');
    expect(buildOpenApiDocument()).toMatchObject({
      components: {
        securitySchemes: {
          playClaimantProof: { type: 'apiKey', in: 'header', name: 'X-Sotto-Play-Proof' },
        },
      },
    });
  });

  it('keeps public policy, proof-bound pending consent and private safety operations separate', () => {
    const full = buildOpenApiDocument();
    const paths = full.paths as Record<string, Record<string, { security?: unknown }>>;
    expect(paths['/api/v1/play/policy'].get.security).toBeUndefined();
    expect(paths['/api/v1/play/join-requests/{requestId}/conduct'].post.security).toEqual([
      { playClaimantProof: [] },
    ]);
    for (const path of [
      '/api/v1/play/safety',
      '/api/v1/play/safety/reports',
      '/api/v1/play/safety/review',
    ])
      expect(paths[path].get.security).toEqual([{ bearerAuth: [] }]);
    const components = full.components as { schemas: Record<string, { required?: string[] }> };
    expect(components.schemas.PlayJoinRequest.required).toContain('acceptedConductVersion');
    expect(components.schemas.PlaySafetyError.required).toEqual(
      expect.arrayContaining(['reason', 'error'])
    );
    const codegen = buildOpenApiDocument({ codegen: true });
    expect(codegen.paths).not.toHaveProperty('/api/v1/play/safety');
    expect(codegen.components).not.toHaveProperty('schemas.PlaySafetyStatus');
    expect(codegen.components).not.toHaveProperty('schemas.PlaySafetyError');
  });
});
