import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { z } from 'zod';

const feedbackSchema = z.object({
  type: z.enum(['BUG', 'FEATURE_REQUEST', 'GENERAL', 'PRAISE', 'CONCERN']),
  rating: z.number().int().min(1).max(5).optional(),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  email: z.string().email().max(200).optional(),
  name: z.string().max(100).optional(),
  context: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = feedbackSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const feedback = await prisma.feedback.create({
    data: {
      type: parsed.data.type,
      rating: parsed.data.rating,
      subject: parsed.data.subject,
      message: parsed.data.message,
      email: parsed.data.email,
      name: parsed.data.name,
      context: parsed.data.context,
    },
  });

  return NextResponse.json({ id: feedback.id, message: 'Thank you for your feedback!' }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const feedbacks = await prisma.feedback.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json(feedbacks);
}
