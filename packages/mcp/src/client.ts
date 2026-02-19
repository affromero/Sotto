import type {
  Podcast,
  PodcastDetail,
  FeedResponse,
  UserProfile,
  CreatePodcastParams,
  FeedParams,
  ForkParams,
  UpdatePodcastParams,
} from './types.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SottoClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://sotto.fm') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async createPodcast(params: CreatePodcastParams): Promise<{ id: string; status: string }> {
    const focusAreas = params.focus_areas
      ? params.focus_areas.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    return this.request('/api/podcasts', {
      method: 'POST',
      body: JSON.stringify({
        title: params.title,
        topic: params.topic,
        metadata: {
          topic: params.topic,
          depth: params.depth,
          audienceLevel: params.audience_level,
          focusAreas: focusAreas,
          tone: params.tone,
          durationTarget: params.duration_minutes,
          sourceUrl: params.source_url,
        },
      }),
    });
  }

  async getPodcast(id: string): Promise<PodcastDetail> {
    return this.request(`/api/podcasts/${id}`);
  }

  async listPodcasts(): Promise<Podcast[]> {
    return this.request('/api/podcasts');
  }

  async browseFeed(params: FeedParams = {}): Promise<FeedResponse> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (params.tag) query.set('tag', params.tag);
    if (params.depth) query.set('depth', params.depth);
    if (params.audience) query.set('audience', params.audience);
    if (params.tone) query.set('tone', params.tone);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));

    const qs = query.toString();
    return this.request(`/api/feed${qs ? `?${qs}` : ''}`);
  }

  async forkPodcast(id: string, params: ForkParams = {}): Promise<{ id: string }> {
    const focusAreas = params.focus_areas
      ? params.focus_areas.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    return this.request(`/api/podcasts/${id}/fork`, {
      method: 'POST',
      body: JSON.stringify({
        topic: params.topic,
        remixNote: params.remix_note,
        focusAreas: focusAreas,
        depth: params.depth,
        tone: params.tone,
      }),
    });
  }

  async updatePodcast(id: string, params: UpdatePodcastParams): Promise<Podcast> {
    return this.request(`/api/podcasts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  async deletePodcast(id: string): Promise<void> {
    return this.request(`/api/podcasts/${id}`, { method: 'DELETE' });
  }

  async getMe(): Promise<UserProfile> {
    return this.request('/api/users/me');
  }
}
