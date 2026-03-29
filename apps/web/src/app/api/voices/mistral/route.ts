import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getByokKey } from '@/lib/byok';
import { errorResponse } from '@/lib/api-response';

interface MistralVoice {
  id: string;
  name: string;
  slug: string;
  gender: string;
  age: number;
  languages: string[];
  tags: string[];
  color: string;
  user_id: string | null;
}

interface MistralVoicesResponse {
  items: MistralVoice[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  // Resolve API key: BYOK first, then platform
  const byokKey = await getByokKey(session.user.id, 'mistral');
  const apiKey = byokKey || process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return errorResponse('No Mistral API key configured. Add your key in Settings → Voice Providers.', 400);
  }

  const { searchParams } = request.nextUrl;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const gender = searchParams.get('gender')?.toLowerCase();

  const url = new URL('https://api.mistral.ai/v1/audio/voices');
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', '50');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 401 : 502;
    return errorResponse(
      status === 401 ? 'Invalid Mistral API key' : 'Failed to fetch Mistral voices',
      status
    );
  }

  const data: MistralVoicesResponse = await response.json();

  let voices = data.items.map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    gender: v.gender,
    age: v.age,
    languages: v.languages,
    tags: v.tags,
    isPreset: v.user_id === null,
  }));

  if (gender) {
    voices = voices.filter((v) => v.gender === gender);
  }

  return NextResponse.json({
    voices,
    page: data.page,
    totalPages: data.total_pages,
    total: data.total,
  });
}
