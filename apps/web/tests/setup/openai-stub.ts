// Stub for the optional 'openai' package used by provider tests.
// This file is aliased in vitest.config.ts so Vite can resolve the import.

class OpenAI {
  chat = {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'stub response' } }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'chunk' } }] };
        },
      }),
    },
  };
  audio = {
    speech: {
      create: async () => ({
        arrayBuffer: async () => new ArrayBuffer(8),
      }),
    },
  };

  constructor(_opts?: Record<string, unknown>) {}
}

export default OpenAI;
