// @vitest-environment node
import { expect, it } from 'vitest';
import { GET } from '@/app/.well-known/apple-app-site-association/route';

it('advertises only supported game invitations to the official Apple app', async () => {
  const response = GET();

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({
    applinks: {
      details: [
        {
          appIDs: ['2HVQQ4W769.fm.sotto.app'],
          components: [{ '/': '/play/join' }],
        },
      ],
    },
  });
});
