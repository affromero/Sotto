import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsForm } from '@/app/(dashboard)/settings/SettingsForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const props = {
  initialName: 'Alice',
  email: 'alice@example.test',
  image: null,
  role: 'USER',
  preferredLanguage: 'de',
  speechLanguage: 'de',
  selectedTtsProvider: 'disabled',
  selectedSttProvider: 'cartesia',
  ttsProviderAvailable: false,
  sttProviderAvailable: true,
  interestCategories: [],
  selectedInterestTagIds: [],
  speechTtsProviderMeta: [],
  sttProviderMeta: [
    {
      id: 'cartesia',
      displayName: 'Cartesia',
      defaultModel: 'ink',
      models: [{ id: 'ink', displayName: 'Ink', tier: 'standard', supportedLanguages: ['de'] }],
    },
  ],
  initialPreferredTtsModel: null,
  initialPreferredSttModel: null,
  initialPreferredAiModel: null,
  initialEmailNotifications: false,
  initialPushNotifications: false,
  initialShowAgentUsageStatus: false,
};

describe('profile speech model choices', () => {
  it('filters speech models by the German course rather than the English interface preference', () => {
    render(
      <SettingsForm
        {...props}
        selectedTtsProvider="local"
        preferredLanguage="en"
        speechLanguage="de"
        ttsProviderAvailable
        speechTtsProviderMeta={[
          {
            id: 'local',
            displayName: 'Local',
            models: [
              {
                id: 'german',
                displayName: 'German voice model',
                tier: 'standard',
                supportedLanguages: ['de'],
              },
              {
                id: 'english',
                displayName: 'English voice model',
                tier: 'standard',
                supportedLanguages: ['en'],
              },
            ],
          },
        ]}
      />
    );
    expect(
      screen.getByRole('option', { name: 'German voice model — standard' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'English voice model — standard' })
    ).not.toBeInTheDocument();
  });
  it('labels an absent provider truthfully and cannot save a speech model', () => {
    render(<SettingsForm {...props} selectedTtsProvider={null} />);
    expect(screen.getByText('No speech provider selected')).toBeVisible();
    expect(screen.getByLabelText('Preferred text-to-speech model')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Speech Models' })).toBeDisabled();
  });
  it('shows disabled audio and prevents speech-model changes without a provider-unavailable alert', async () => {
    render(<SettingsForm {...props} />);
    expect(screen.getByLabelText('Preferred text-to-speech model')).toBeDisabled();
    expect(screen.getByLabelText('Preferred speech-to-text model')).toBeDisabled();
    expect(
      screen.getByText(
        'Text learning continues; listening and speaking are skipped until you turn audio on.'
      )
    ).toBeVisible();
    expect(screen.queryByText('Text-to-speech provider unavailable.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Speech Models' })).toBeDisabled();
  });

  it('retains the explicitly selected local model in the provider dropdown', async () => {
    render(
      <SettingsForm
        {...props}
        selectedTtsProvider="local"
        ttsProviderAvailable
        initialPreferredTtsModel="piper"
        speechTtsProviderMeta={[
          {
            id: 'local',
            displayName: 'Local',
            models: [
              { id: 'piper', displayName: 'piper', tier: 'local', supportedLanguages: ['de'] },
            ],
          },
        ]}
      />
    );
    expect(screen.getByLabelText('Preferred text-to-speech model')).toHaveValue('piper');
    await userEvent.selectOptions(screen.getByLabelText('Preferred text-to-speech model'), '');
    expect(screen.getByLabelText('Preferred text-to-speech model')).toHaveValue('');
  });
});
