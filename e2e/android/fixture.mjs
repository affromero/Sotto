import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export async function startAndroidFixture(root) {
  const fixtures = JSON.parse(
    await readFile(`${root}/packages/shared/fixtures/play/contract.json`, 'utf8')
  );
  const room = fixtures.rooms.find((entry) => entry.name === 'playing-GUEST').room;
  const token = `fixture-${randomBytes(24).toString('hex')}`;
  const profile = { id: room.guest.id, name: 'Sam', isOwner: false, role: 'USER' };
  const received = [];
  const failures = [];
  let phase = 'before';
  let requestID;
  let created;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        assert.ok(length <= 16_384);
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const path = new URL(request.url, 'http://fixture').pathname;
      const entry = { path, method: request.method, body: raw, headers: request.headers };
      received.push(entry);
      let status = 200;
      let body;
      assert.equal(request.headers.cookie, undefined);
      assert.equal(request.headers.origin, undefined);
      if (path === '/api/v1/play/invitations' && request.method === 'GET') {
        body = {
          roomId: room.id,
          hostName: 'Alex',
          kind: room.kind,
          theme: room.theme,
          questionStyle: room.questionStyle,
          hostWaiting: true,
          expiresAt: '2099-01-01T00:00:00Z',
          serverTime: room.serverTime,
        };
      } else if (path === '/api/v1/play/invitations' && request.method === 'POST') {
        const input = JSON.parse(raw);
        assert.equal(input.candidate.kind, 'NEW');
        assert.equal(input.candidate.consentToProfile, true);
        assert.match(request.headers['x-sotto-play-proof'], /^[A-Za-z0-9_-]{43}$/);
        requestID = input.requestId;
        status = 201;
        body = joinStatus();
      } else if (path === `/api/v1/play/join-requests/${requestID}`) {
        body = joinStatus();
      } else if (path.endsWith('/claim')) {
        assert.equal(request.headers.authorization, undefined);
        body = {
          kind: 'NATIVE',
          deliveryId: 'fixture-delivery',
          roomId: room.id,
          profile: room.guest,
          token,
          expiresAt: null,
        };
      } else if (path.endsWith('/ack')) {
        assert.equal(request.headers.authorization, undefined);
        status = phase === 'before' ? 503 : 200;
        body = status === 503 ? { error: 'Acknowledgment unavailable' } : { acknowledged: true };
      } else if (path === '/api/v1/profiles') {
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        body = { profiles: [profile] };
      } else if (path === `/api/v1/play/rooms/${room.id}`) {
        body = room;
      } else if (path === '/api/v1/play/rooms' && request.method === 'POST') {
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        assert.equal(request.headers['x-sotto-play-profile'], profile.id);
        if (phase === 'before') {
          status = 503;
          body = { error: 'Room creation unavailable' };
        } else {
          const original = received.find((entry) => entry.path === path && entry.method === 'POST');
          assert.equal(raw, original.body);
          const input = JSON.parse(raw);
          created = {
            ...room,
            id: 'recovered-room',
            status: 'WAITING',
            revision: 0,
            kind: input.kind,
            theme: input.theme,
            questionStyle: input.questionStyle,
            ownSeat: 'HOST',
            host: { ...room.guest, settings: input.settings },
            guest: null,
            round: null,
            completedRounds: [],
            points: 0,
            rematchRoomId: null,
            allowedActions: ['CANCEL'],
          };
          body = created;
        }
      } else if (path === '/api/v1/play/rooms') {
        body = { rooms: created ? [created, room] : [room], nextCursor: null };
      } else if (path === '/api/v1/play/rooms/recovered-room') {
        body = created;
      } else if (path.endsWith('/presence')) {
        body = {
          hostWaiting: true,
          expiresAt: '2099-01-01T00:00:00Z',
          serverTime: room.serverTime,
        };
      } else if (path.endsWith('/invitations')) {
        body = null;
      } else if (path.endsWith('/join-requests')) {
        body = { requests: [] };
      } else if (path === '/api/v1/play/enrollments') {
        status = 403;
        body = { error: 'Owner required' };
      } else {
        status = 404;
        body = { error: 'Request has not arrived yet' };
      }
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(body));
    } catch (error) {
      failures.push(error);
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end('{"error":"Fixture protocol failure"}');
    }
  });
  function joinStatus() {
    return {
      requestId: requestID,
      status: phase === 'before' ? 'ACCEPTED' : 'CLAIMED',
      expiresAt: '2099-01-01T00:00:00Z',
      serverTime: room.serverTime,
    };
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://10.0.2.2:${server.address().port}`,
    received,
    failures,
    advance() {
      phase = 'after';
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
