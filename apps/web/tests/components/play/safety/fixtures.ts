import safety from '../../../../../../packages/shared/fixtures/play/safety.json';
import contract from '../../../../../../packages/shared/fixtures/play/contract.json';
import { playRoomViewSchema } from '@sotto/shared';

export { safety, contract };

export function safetyResponse(path: string): Response | null {
  if (path === '/api/v1/play/policy') return Response.json(safety.policy);
  if (path === '/api/v1/play/safety') return Response.json(safety.accepted);
  return null;
}

export function safetyRoom(name = 'playing-HOST') {
  const entry = contract.rooms.find((item) => item.name === name);
  if (!entry) throw new Error('Missing actual room fixture');
  return playRoomViewSchema.parse(entry.room);
}
