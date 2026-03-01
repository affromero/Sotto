import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getByokKey } from '@/lib/byok';
import { errorResponse } from '@/lib/api-response';

interface HumeVoice {
  id: string;
  name: string;
  provider: string;
  tags: {
    LANGUAGE?: string[];
    ACCENT?: string[];
    GENDER?: string[];
    AGE?: string[];
  };
  compatible_octave_models?: string[];
}

interface HumeVoicesResponse {
  page_number: number;
  page_size: number;
  total_pages: number;
  voices_page: HumeVoice[];
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  // Resolve API key: BYOK first, then platform
  const byokKey = await getByokKey(session.user.id, 'hume');
  const apiKey = byokKey || process.env.HUME_API_KEY;
  if (!apiKey) {
    return errorResponse('No Hume API key configured. Add your key in Settings → Voice Providers.', 400);
  }

  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get('page') || '0', 10);
  const gender = searchParams.get('gender')?.toUpperCase();
  const language = searchParams.get('language');
  const voiceProvider = searchParams.get('provider') || 'HUME_AI';

  // Custom voices require a BYOK key (no platform key fallback)
  if (voiceProvider === 'CUSTOM_VOICE' && !byokKey) {
    return errorResponse('Hume BYOK key required to browse custom voices', 400);
  }

  const url = new URL('https://api.hume.ai/v0/tts/voices');
  url.searchParams.set('provider', voiceProvider);
  url.searchParams.set('page_size', '100');
  url.searchParams.set('page_number', String(page));

  const response = await fetch(url.toString(), {
    headers: { 'X-Hume-Api-Key': apiKey },
  });

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 401 : 502;
    return errorResponse(
      status === 401 ? 'Invalid Hume API key' : 'Failed to fetch Hume voices',
      status
    );
  }

  const data: HumeVoicesResponse = await response.json();

  let voices = data.voices_page.map((v) => ({
    id: v.id,
    name: v.name,
    gender: ((v.tags.GENDER || [])[0] || 'unknown').toLowerCase(),
    age: ((v.tags.AGE || [])[0] || 'unknown').toLowerCase(),
    accent: (v.tags.ACCENT || []).join(', '),
    language: (v.tags.LANGUAGE || []).join(', '),
    models: v.compatible_octave_models || [],
  }));

  // Client-side filtering
  if (gender) {
    voices = voices.filter((v) => v.gender === gender.toLowerCase());
  }
  if (language) {
    voices = voices.filter((v) =>
      v.language.toLowerCase().includes(language.toLowerCase())
    );
  }

  return NextResponse.json({
    voices,
    page: data.page_number,
    totalPages: data.total_pages,
  });
}
