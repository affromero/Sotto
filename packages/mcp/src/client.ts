import type {
  Podcast,
  PodcastDetail,
  UserProfile,
  CreatePodcastParams,
  IngestAgentOutputParams,
  AgentIngestResult,
  UpdatePodcastParams,
} from './types.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SottoClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string) {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      throw new Error('SottoClient requires a non-empty API key');
    }

    this.apiKey = normalizedApiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
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
      ? params.focus_areas
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    return this.request('/api/v1/podcasts', {
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

  async ingestAgentOutput(params: IngestAgentOutputParams): Promise<AgentIngestResult> {
    const focusAreas = params.focus_areas
      ? params.focus_areas
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    return this.request('/api/v1/ingest/agent', {
      method: 'POST',
      body: JSON.stringify({
        title: params.title,
        topic: params.topic,
        content: params.content,
        idempotencyKey: params.idempotency_key,
        sourceUrl: params.source_url,
        durationTarget: params.duration_minutes,
        depth: params.depth,
        audienceLevel: params.audience_level,
        tone: params.tone,
        focusAreas,
        agent: {
          provider: params.agent_provider,
          name: params.agent_name,
          model: params.agent_model,
          runId: params.agent_run_id,
        },
        aiModel: params.ai_model,
        ttsProvider: params.tts_provider,
        ttsModel: params.tts_model,
      }),
    });
  }

  async getPodcast(id: string): Promise<PodcastDetail> {
    return this.request(`/api/v1/podcasts/${id}`);
  }

  async listPodcasts(): Promise<Podcast[]> {
    return this.request('/api/v1/podcasts');
  }

  async updatePodcast(id: string, params: UpdatePodcastParams): Promise<Podcast> {
    return this.request(`/api/v1/podcasts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  async deletePodcast(id: string): Promise<void> {
    return this.request(`/api/v1/podcasts/${id}`, { method: 'DELETE' });
  }

  async getMe(): Promise<UserProfile> {
    return this.request('/api/v1/users/me');
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('SottoClient requires an explicit API base URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid SOTTO_API_URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SOTTO_API_URL must use http or https');
  }

  return parsed.toString().replace(/\/+$/, '');
}
