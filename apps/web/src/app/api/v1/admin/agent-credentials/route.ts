import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { credentialReloadAvailable, reloadProviderCredentials } from '@/lib/agent-credentials';
import { getAgentStatus } from '@/lib/agent-availability';

const schema = z.object({ provider: z.enum(['claude-code', 'codex']) });

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Invalid credential reload request', 400);
  const { provider } = parsed.data;
  if (!credentialReloadAvailable(provider)) {
    return errorResponse('Credential reload is unavailable for this provider', 409);
  }
  try {
    await reloadProviderCredentials(provider);
    return NextResponse.json({ provider, status: await getAgentStatus(provider) });
  } catch {
    return errorResponse('Could not reload CLI credentials', 503);
  }
}
