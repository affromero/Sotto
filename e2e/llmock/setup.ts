import { LLMock } from '@copilotkit/llmock';

const LLMOCK_PORT = 4100;

export async function createMockServer() {
  const mock = new LLMock({ port: LLMOCK_PORT });

  // Discovery chat — responds with topic suggestions and metadata
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('discovery') || systemText.includes('Discovery');
      },
    },
    {
      content: `Great choice! Let me help you explore that topic.

Here are some angles we could take:

[METADATA]
chips: ["AI Breakthroughs 2025", "Ethics of Automation", "Open Source vs Closed"]
topics_explored: 1
readiness: 0.6
[/METADATA]`,
    }
  );

  // Script generation — returns a two-voice podcast script
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('podcast script') || systemText.includes('Script Generation');
      },
    },
    {
      content: `HOST: Welcome to today's episode where we dive deep into one of the most fascinating topics in technology. [1]

EXPERT: Thanks for having me. This is a subject that's been on everyone's mind lately, and there's a lot to unpack. [2]

HOST: Let's start with the basics. Can you give our listeners a quick overview?

EXPERT: Absolutely. At its core, this technology works by processing vast amounts of data to find patterns that humans might miss. [3]

HOST: That's incredible. And what are the real-world implications?

EXPERT: The implications are enormous. We're seeing applications in healthcare, education, and even creative fields. [4]

HOST: Thank you so much for joining us today. This has been an eye-opening conversation.

EXPERT: My pleasure. There's so much more to explore, and I'm excited to see where this goes.

[REFERENCES]
[1] Smith, J. (2025). "Advances in AI Technology." Nature, 612, 45-52.
[2] Johnson, A. (2025). "Public Perception of AI." Science, 380, 112-118.
[3] Williams, K. (2024). "Pattern Recognition in Large Datasets." IEEE, 15(3), 234-241.
[4] Brown, L. (2025). "AI Applications Across Industries." Harvard Business Review.
[/REFERENCES]`,
    }
  );

  // Interaction / Q&A — responds to mid-playback questions
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('interaction') || systemText.includes('Interaction');
      },
    },
    {
      content:
        "Great question! Based on what we discussed in the episode, this technology works by using neural networks trained on massive datasets. The key insight is that it doesn't just memorize — it learns underlying patterns and can generalize to new situations. Think of it like learning to ride a bike: once you understand balance, you can ride any bike, not just the one you learned on.",
    }
  );

  // Script verification / fact-checking
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('verify') || systemText.includes('fact-check');
      },
    },
    { content: '{"verified": true, "issues": [], "confidence": 0.95}' }
  );

  // Taste quiz / onboarding
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('taste') || systemText.includes('onboarding');
      },
    },
    {
      content:
        '[{"id":"q1","topic":"Coffee History","tags":["history","food"]},{"id":"q2","topic":"Space Exploration","tags":["science","technology"]}]',
    }
  );

  // Fork / remix — generates a remixed podcast script
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('fork') || systemText.includes('remix') || systemText.includes('Fork');
      },
    },
    {
      content: `HOST: Welcome to this remix where we take a fresh look at an existing conversation. [1]

EXPERT: I love how we're building on what came before while adding a completely new perspective. [2]

HOST: Let's dive into what makes this angle unique.

EXPERT: The key difference here is that we're approaching it from a practical standpoint rather than theoretical.

HOST: Fascinating. Thanks for this fresh take!

[REFERENCES]
[1] Original Podcast. (2025). "E2E Test Podcast." Sotto.
[2] Remix Analysis. (2025). "Building on Ideas." Internal.
[/REFERENCES]`,
    }
  );

  // Script editing / revision — returns a revised script
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('revised') || systemText.includes('edit') || systemText.includes('regenerat');
      },
    },
    {
      content: `HOST: Welcome back to our revised episode with some exciting updates. [1]

EXPERT: Thanks for having me again. We've refined our discussion based on new insights. [2]

HOST: What's changed since our last conversation?

EXPERT: We now have stronger evidence supporting our initial claims, plus some surprising new developments.

HOST: That's wonderful. Thank you for the update!

[REFERENCES]
[1] Updated Research. (2025). "New Findings." Nature, 615, 78-85.
[2] Expert Review. (2025). "Revised Analysis." Science, 382, 201-208.
[/REFERENCES]`,
    }
  );

  // Incorporate — generates a segment incorporating a Q&A answer
  mock.on(
    {
      predicate: (req) => {
        const systemMsg = req.messages.find((m) => m.role === 'system');
        const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
        return systemText.includes('incorporat');
      },
    },
    {
      content: `HOST: That's a great question from one of our listeners. Let me address it directly.

EXPERT: Absolutely. The answer ties back to what we discussed earlier about pattern recognition. When you apply these principles consistently, the results speak for themselves. It's one of those insights that seems obvious in hindsight but takes real understanding to appreciate fully.

HOST: Wonderful addition to the conversation. Let's continue.`,
    }
  );

  // Fallback for unmatched requests
  mock.on({ predicate: () => true }, { content: 'Mock response — no specific fixture matched this request.' });

  return mock;
}

// Run as standalone script
const isMainModule = process.argv[1]?.endsWith('setup.ts') || process.argv[1]?.endsWith('setup.js');
if (isMainModule) {
  (async () => {
    const mock = await createMockServer();
    const url = await mock.start();
    console.log(`LLMock server running at ${url}`);
    console.log('Press Ctrl+C to stop');

    process.on('SIGINT', async () => {
      await mock.stop();
      process.exit(0);
    });
  })();
}
