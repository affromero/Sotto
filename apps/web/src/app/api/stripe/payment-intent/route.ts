import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { createVoicePayment } from '@/lib/voice-pricing';

const paymentIntentSchema = z.object({
  voiceCharges: z.array(z.object({
    voiceCloneId: z.string().min(1),
    podcastId: z.string().min(1).optional(),
  })).min(1).max(20),
});

/**
 * POST: Create PaymentIntent(s) for voice charges.
 * Uses manual capture — authorized upfront, captured on READY, cancelled on FAILED.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = paymentIntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { voiceCharges } = parsed.data;

  const results: Array<{ voiceCloneId: string; clientSecret: string; paymentIntentId: string }> =
    [];

  for (const charge of voiceCharges) {
    // Use a placeholder podcastId — will be updated when podcast is created
    const podcastId = charge.podcastId || 'pending';
    const result = await createVoicePayment(session.user.id, charge.voiceCloneId, podcastId);
    results.push({
      voiceCloneId: charge.voiceCloneId,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
    });
  }

  return NextResponse.json({
    payments: results,
    paymentIntentIds: results.map((r) => r.paymentIntentId),
  });
}
