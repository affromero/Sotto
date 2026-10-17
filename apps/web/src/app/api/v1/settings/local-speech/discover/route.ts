import { localSpeechRequest } from '@/lib/providers/local-speech/settings';

export async function POST(request: Request) {
  return localSpeechRequest(request, 'discover');
}
