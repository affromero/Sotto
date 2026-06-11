import { handlers } from '@/lib/auth';
import { NextRequest} from 'next/server';
import { checkRateLimit } from '@/lib/redis';

import { errorResponse } from '@/lib/api-response';
export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  const { allowed } = await checkRateLimit(`auth:nextauth:${ip}`, 20, 15 * 60);
  if (!allowed) {
    return errorResponse('Too many attempts', 429);
  }
  return handlers.POST(request);
}
