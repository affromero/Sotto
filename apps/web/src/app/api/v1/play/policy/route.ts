import { playEmptyQuerySchema, playSafetyPolicySchema } from '@sotto/shared';
import { limitPlayOperation, playJson, playOperation, playQuery } from '@/lib/play/http';
import { readPlaySafetyPolicy } from '@/lib/play/safety/policy';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return playOperation(request, false, async () => {
    playQuery(request, playEmptyQuerySchema);
    await limitPlayOperation('policy:instance', 120);
    return playJson(playSafetyPolicySchema, readPlaySafetyPolicy());
  });
}
