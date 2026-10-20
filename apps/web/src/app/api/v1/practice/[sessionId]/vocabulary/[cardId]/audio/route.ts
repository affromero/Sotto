import type { NextRequest } from 'next/server';
import { vocabularyAudioRoute } from '@/lib/vocabulary/audio/route';

type Params = { params: Promise<{ sessionId: string; cardId: string }> };
export async function POST(request: NextRequest, { params }: Params) {
  return vocabularyAudioRoute(request, await params);
}
export async function GET(request: NextRequest, { params }: Params) {
  return vocabularyAudioRoute(request, await params);
}
