import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepReady } from '@/app/welcome/steps/StepReady';
import { DEFAULT_AGENT, DEFAULT_VOICE } from '@/app/welcome/session/welcome-snapshot';
import { createWelcomeCredentialBoundary } from '../../helpers/setup/welcome-credentials';

const navigation = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  navigation.mockReset();
});

it.each(['', 'optional-server-authentication'])(
  'keeps live-conversation credentials separate when completing a compatible course (%s)',
  async (apiKey) => {
    const http = createWelcomeCredentialBoundary();
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, options?: RequestInit) => {
      const credentialResponse = http.handle(input, options);
      if (credentialResponse) return credentialResponse;
      expect(String(input)).toBe('/api/v1/onboarding/save');
      posted.push(JSON.parse(String(options?.body)));
      return Response.json({ demo: false, courseId: 'completed-course' });
    });
    const user = userEvent.setup();
    render(
      <StepReady
        baseLang="es"
        language="fr"
        level="A1"
        sources={new Set(['reading'])}
        contextItems={[]}
        agent={{
          ...DEFAULT_AGENT,
          provider: 'local',
          method: 'url',
          value: 'https://completion.example/v1',
          model: 'conversation-tutor',
          liveTranslationKey: 'live-conversation-authentication',
          apiKey,
          status: 'connected',
        }}
        voice={{ ...DEFAULT_VOICE, tts: 'local', stt: 'local', visualCueProvider: 'off' }}
        config={{ selfHosted: true, isOwner: true }}
        saveCredentials={http.saveCredentials}
        submitSetup={http.submitSetup}
        onRestart={vi.fn()}
        onJump={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /open today's session/i }));
    await waitFor(() => expect(navigation).toHaveBeenCalledWith('/learn'));
    expect(http.saved.get('ai-keys:google')).toEqual({
      apiKey: 'live-conversation-authentication',
    });
    expect(http.saved.get('ai-keys:local')).toEqual(apiKey ? { apiKey } : undefined);
    expect(posted).toMatchObject([
      {
        course: { native: 'es', target: 'fr', level: 'A1' },
        preferred: { aiProvider: 'local', aiModel: 'local:conversation-tutor' },
        infra: { aiBaseUrl: 'https://completion.example/v1' },
      },
    ]);
    expect(JSON.stringify(posted)).not.toContain('live-conversation-authentication');
    expect(JSON.stringify(posted)).not.toContain('optional-server-authentication');
  }
);
