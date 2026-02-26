import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { referralSchema } from '@/lib/validations';
import { attributeReferral } from '@/lib/referrals';
import { errorResponse } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = referralSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const attributed = await attributeReferral(session.user.id, parsed.data.handle);

  if (!attributed) {
    return NextResponse.json({ message: 'Already referred or referrer not found' }, { status: 200 });
  }

  return NextResponse.json({ message: 'Referral attributed' }, { status: 200 });
}
