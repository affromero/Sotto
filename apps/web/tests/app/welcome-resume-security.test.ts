import { expect, it } from 'vitest';
import { resumeEndpoint, resumeEndpoints } from '@/app/welcome/session/resume-security';
import { parseStoredSnapshot } from '@/app/welcome/session/welcome-snapshot';

it('removes browser credentials and connection claims while retaining safe resume choices', () => {
  const result = parseStoredSnapshot(
    JSON.stringify({
      step: 4,
      language: 'de',
      agent: {
        provider: 'claude',
        method: 'key',
        value: 'old-secret',
        liveTranslationKey: 'live-secret',
        status: 'connected',
      },
      voice: {
        tts: 'playht',
        keys: { playht: 'speech-secret', userId: 'account-secret' },
        baseUrls: { local: 'http://localhost:8000' },
      },
    })
  );
  expect(result).toMatchObject({
    step: 4,
    language: 'de',
    agent: { provider: 'claude', value: '', liveTranslationKey: '', status: 'idle' },
    voice: { tts: 'playht', keys: {}, baseUrls: { local: 'http://localhost:8000' } },
  });
  expect(result?.agent.value).toBe('');
  expect(result?.agent.liveTranslationKey).toBe('');
  expect(result?.voice.keys).toEqual({});
  expect(result?.storage.accessKeyId).toBe('');
  expect(result?.storage.secretAccessKey).toBe('');
});

it('resumes a local AI URL without restoring its previous connection claim', () => {
  expect(
    parseStoredSnapshot(
      JSON.stringify({
        agent: {
          provider: 'local',
          method: 'url',
          value: 'http://localhost:8000/v1',
          status: 'connected',
        },
      })
    )?.agent
  ).toMatchObject({ method: 'url', value: 'http://localhost:8000/v1', status: 'idle' });
});

it.each(['http://localhost:8000/v1', 'https://models.example.com/api'])(
  'retains a safe endpoint for resume: %s',
  (url) => {
    expect(resumeEndpoint(url)).toBe(url);
  }
);

it.each([
  'https://user:secret@example.com',
  'https://example.com?key=secret',
  'https://example.com#secret',
  'file:///tmp/secret',
  'private-api-key',
])('excludes credentials and unsupported locations from resume: %s', (value) => {
  expect(resumeEndpoint(value)).toBe('');
});

it('preserves safe voice locations while discarding a credential-bearing URL', () => {
  expect(
    resumeEndpoints({ local: 'http://localhost:8000', custom: 'https://example.com?token=secret' })
  ).toEqual({ local: 'http://localhost:8000', custom: '' });
});
