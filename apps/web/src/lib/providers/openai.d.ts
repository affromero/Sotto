// Type declarations for optional 'openai' dependency.
// Install with: npm install openai
declare module 'openai' {
  interface ChatCompletionChoice {
    message?: { content: string | null };
    delta?: { content?: string };
  }

  interface ChatCompletion {
    choices: ChatCompletionChoice[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  }

  interface AudioSpeechResponse {
    arrayBuffer(): Promise<ArrayBuffer>;
  }

  class OpenAI {
    constructor(opts: { apiKey: string; baseURL?: string; maxRetries?: number });
    chat: {
      completions: {
        create(params: Record<string, unknown>): Promise<ChatCompletion & AsyncIterable<{ choices: ChatCompletionChoice[] }>>;
      };
    };
    audio: {
      speech: {
        create(params: Record<string, unknown>): Promise<AudioSpeechResponse>;
      };
    };
  }

  export default OpenAI;
}
