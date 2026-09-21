import { accessHandler } from '@/lib/sidedoor/access/core/http';
import { errorResponse } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
  let response: Response;
  try {
    const { action } = await context.params;
    response = await accessHandler()(request, action);
  } catch {
    response = errorResponse(
      'Access is unavailable. Check the instance configuration and access migration.',
      503
    );
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export { handle as GET, handle as POST };
