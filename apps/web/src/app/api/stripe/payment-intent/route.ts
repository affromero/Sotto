import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createVoicePayment } from '@/lib/voice-pricing';

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
  const voiceCharges: Array<{ voiceCloneId: string; podcastId?: string }> =
    body.voiceCharges;

  if (!Array.isArray(voiceCharges) || voiceCharges.length === 0) {
    return NextResponse.json({ error: 'voiceCharges is required' }, { status: 400 });
  }

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
